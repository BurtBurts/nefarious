import logging
from django.contrib.auth.models import User
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_page
from rest_framework import viewsets, views
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from nefarious.api.mixins import UserReferenceViewSetMixin
from nefarious.transmission import get_transmission_client
from nefarious.tmdb import get_tmdb_client
from nefarious.api.serializers import (
    NefariousSettingsSerializer, WatchTVEpisodeSerializer, WatchTVShowSerializer,
    UserSerializer, WatchMovieSerializer, NefariousPartialSettingsSerializer,
    TransmissionTorrentSerializer)
from nefarious.models import NefariousSettings, WatchTVEpisode, WatchTVShow, WatchMovie, TorrentBlacklist
from nefarious.parsers.tv import TVParser
from nefarious.search import MEDIA_TYPE_MOVIE, MEDIA_TYPE_TV, SearchTorrents
from nefarious.tasks import watch_tv_episode_task, watch_tv_show_season_task, watch_movie_task, refresh_tmdb_configuration
from nefarious.utils import (
    trace_torrent_url, swap_jackett_host, is_magnet_url, needs_tmdb_configuration,
    verify_settings_jackett, verify_settings_transmission, verify_settings_tmdb,
)

CACHE_MINUTES = 60 * 60 * 12


class WatchMovieViewSet(UserReferenceViewSetMixin, viewsets.ModelViewSet):
    queryset = WatchMovie.objects.all()
    serializer_class = WatchMovieSerializer

    def perform_create(self, serializer):
        super().perform_create(serializer)
        # create a task to download the episode
        watch_movie_task.delay(serializer.instance.id)

    @action(['post'], detail=True, url_path='blacklist-auto-retry')
    def blacklist_auto_retry(self, request, pk):
        watch_movie = self.get_object()  # type: WatchMovie
        nefarious_settings = NefariousSettings.objects.all().get()

        # add to blacklist
        logging.info('Blacklisting {}'.format(watch_movie.transmission_torrent_hash))
        TorrentBlacklist.objects.get_or_create(hash=watch_movie.transmission_torrent_hash)

        # unset previous transmission details
        del_transmission_torrent_id = watch_movie.transmission_torrent_id
        watch_movie.transmission_torrent_id = None
        watch_movie.transmission_torrent_hash = None
        watch_movie.save()

        # re-queue search
        watch_movie_task.delay(watch_movie.id)

        # remove torrent and delete data
        logging.info('Removing blacklisted torrent id: {}'.format(del_transmission_torrent_id))
        transmission_client = get_transmission_client(nefarious_settings=nefarious_settings)
        transmission_client.remove_torrent([del_transmission_torrent_id], delete_data=True)

        return Response(WatchMovieSerializer(watch_movie).data)


class WatchTVShowViewSet(UserReferenceViewSetMixin, viewsets.ModelViewSet):
    queryset = WatchTVShow.objects.all()
    serializer_class = WatchTVShowSerializer

    @action(methods=['post', 'get'], detail=True, url_path='entire-season')
    def watch_entire_season(self, request, pk):
        watch_tv_show = self.get_object()  # type: WatchTVShow
        nefarious_settings = NefariousSettings.objects.all().get()
        data = request.query_params or request.data

        if 'season_number' not in data:
            raise ValidationError({'season_number': ['This field is required']})

        tmdb = get_tmdb_client(nefarious_settings)
        season_request = tmdb.TV_Seasons(watch_tv_show.tmdb_show_id, data['season_number'])
        season = season_request.info()

        # save individual episode watches
        for episode in season['episodes']:
            WatchTVEpisode.objects.get_or_create(
                user=request.user,
                watch_tv_show=watch_tv_show,
                tmdb_episode_id=episode['id'],
                season_number=data['season_number'],
                episode_number=episode['episode_number'],
            )

        # create a task to download the whole season
        watch_tv_show_season_task.delay(watch_tv_show.id, data['season_number'])

        return Response(
            WatchTVEpisodeSerializer(watch_tv_show.watchtvepisode_set.all(), many=True).data)


class WatchTVEpisodeViewSet(UserReferenceViewSetMixin, viewsets.ModelViewSet):
    queryset = WatchTVEpisode.objects.all()
    serializer_class = WatchTVEpisodeSerializer

    def perform_create(self, serializer):
        super().perform_create(serializer)
        # create a task to download the episode
        watch_tv_episode_task.delay(serializer.instance.id)


class SettingsViewSet(viewsets.ModelViewSet):
    queryset = NefariousSettings.objects.all()

    @action(methods=['get'], detail=True)
    def verify(self, request, pk):
        nefarious_settings = self.queryset.get(id=pk)
        try:
            verify_settings_jackett(nefarious_settings)
            verify_settings_tmdb(nefarious_settings)
            verify_settings_transmission(nefarious_settings)
        except Exception as e:
            raise ValidationError(str(e))
        return Response()

    def list(self, request, *args, **kwargs):
        # asynchronously refresh tmdb configuration (if necessary)
        nefarious_settings = self.queryset
        if nefarious_settings.exists() and needs_tmdb_configuration(nefarious_settings.get()):
            refresh_tmdb_configuration.delay()
        return super().list(request, *args, **kwargs)

    def get_serializer_class(self):
        if self.request.user.is_staff:
            return NefariousSettingsSerializer
        return NefariousPartialSettingsSerializer


class CurrentUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer

    def get_queryset(self):
        return self.queryset.filter(username=self.request.user.username)


class MediaDetailView(views.APIView):

    @method_decorator(cache_page(CACHE_MINUTES))
    def get(self, request, media_type, media_id):
        nefarious_settings = NefariousSettings.objects.get()
        tmdb = get_tmdb_client(nefarious_settings)

        if media_type == MEDIA_TYPE_MOVIE:
            movie = tmdb.Movies(media_id)
            response = movie.info()
        else:
            tv = tmdb.TV(media_id)
            response = tv.info()
            for season in response['seasons']:
                seasons_request = tmdb.TV_Seasons(response['id'], season['season_number'])
                seasons = seasons_request.info()
                season['episodes'] = seasons['episodes']

        return Response(response)


class SearchMediaView(views.APIView):

    @method_decorator(cache_page(CACHE_MINUTES))
    def get(self, request):
        media_type = request.query_params.get('media_type', MEDIA_TYPE_TV)
        assert media_type in [MEDIA_TYPE_TV, MEDIA_TYPE_MOVIE]

        nefarious_settings = NefariousSettings.objects.get()

        # prepare query
        tmdb = get_tmdb_client(nefarious_settings)
        query = request.query_params.get('q')

        # search for media
        search = tmdb.Search()

        if media_type == MEDIA_TYPE_MOVIE:
            results = search.movie(query=query)
        else:
            results = search.tv(query=query)

        return Response(results)


class SearchTorrentsView(views.APIView):

    @method_decorator(cache_page(CACHE_MINUTES))
    def get(self, request):
        query = request.query_params.get('q')
        media_type = request.query_params.get('media_type', MEDIA_TYPE_MOVIE)
        search = SearchTorrents(media_type, query)
        if not search.ok:
            return Response({'error': search.error_content}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(search.results)


class DownloadTorrentsView(views.APIView):

    def post(self, request):
        nefarious_settings = NefariousSettings.objects.get()
        torrent = request.data.get('torrent')
        if not is_magnet_url(torrent):
            torrent = swap_jackett_host(torrent, nefarious_settings)

        if not torrent:
            return Response({'success': False, 'error': 'Missing torrent link'})

        try:
            torrent = trace_torrent_url(torrent)
        except Exception as e:
            return Response({'success': False, 'error': 'An unknown error occurred', 'error_detail': str(e)})

        logging.info('adding torrent: {}'.format(torrent))

        # add torrent
        transmission_client = get_transmission_client(nefarious_settings)
        transmission_client.add_torrent(torrent, paused=True)
        
        return Response({'success': True})


class CurrentTorrentsView(views.APIView):

    def get(self, request, torrent_id=None):
        nefarious_settings = NefariousSettings.objects.get()
        transmission_client = get_transmission_client(nefarious_settings)
        params = {}
        try:
            if torrent_id is not None:
                result = transmission_client.get_torrent(torrent_id)
            else:
                ids = request.query_params.getlist('ids')
                result = transmission_client.get_torrents(ids)
                params['many'] = True
        except Exception as e:
            logging.error(str(e))
            raise ValidationError({'torrent_id': [str(e)]})

        return Response(TransmissionTorrentSerializer(result, **params).data)
