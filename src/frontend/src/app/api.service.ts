import { LocalStorage } from '@ngx-pwa/local-storage';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, mergeMap} from 'rxjs/operators';
import * as _ from 'lodash';
import { forkJoin, Observable, of, zip } from 'rxjs';


@Injectable({
  providedIn: 'root'
})
export class ApiService {
  STORAGE_KEY_API_TOKEN = 'NEFARIOUS-API-TOKEN';
  STORAGE_KEY_USER = 'NEFARIOUS-USER';
  API_URL_USER = '/api/user/';
  API_URL_LOGIN = '/api/auth/';
  API_URL_SETTINGS = '/api/settings/';
  API_URL_SEARCH_TORRENTS = '/api/search/torrents/';
  API_URL_DOWNLOAD_TORRENTS = '/api/download/torrents/';
  API_URL_SEARCH_MEDIA = '/api/search/media/';
  API_URL_WATCH_TV_EPISODE = '/api/watch-tv-episode/';
  API_URL_WATCH_TV_SHOW = '/api/watch-tv-show/';
  API_URL_WATCH_MOVIE = '/api/watch-movie/';
  API_URL_CURRENT_TORRENTS = '/api/current/torrents/';

  SEARCH_MEDIA_TYPE_TV = 'tv';
  SEARCH_MEDIA_TYPE_MOVIE = 'movie';

  public user: any;
  public userToken: string;
  public settings: any;
  public watchTVEpisodes: any[] = [];
  public watchTVShows: any[] = [];
  public watchMovies: any[] = [];
  public searchQuery: {
    query: string,
    type: string,
  } = {
    query: '',
    type: this.SEARCH_MEDIA_TYPE_TV,
  };

  constructor(
    private http: HttpClient,
    private localStorage: LocalStorage,
  ) {
  }

  public init(): Observable<any> {

    return this.loadFromStorage().pipe(
      mergeMap((data) => {
        if (this.user) {
          console.log('logged in with token: %s, fetching user', this.userToken);
          return this.fetchUser().pipe(
            mergeMap(() => {
              console.log('fetching core data');
              return this.fetchCoreData();
            })
          );
        } else {
          console.log('not logged in');
          return of(null);
        }
      }),
    );
  }

  protected _requestHeaders() {
    return new HttpHeaders({
        'Content-Type':  'application/json',
        'Authorization': `Token ${this.userToken}`,
    });
  }

  public loadFromStorage(): Observable<any> {
    return zip(
      this.localStorage.getItem(this.STORAGE_KEY_API_TOKEN).pipe(
        map(
          (data: string) => {
            this.userToken = data;
            return this.userToken;
          }),
      ),
      this.localStorage.getItem(this.STORAGE_KEY_USER).pipe(
        map(
          (data) => {
          this.user = data;
          return this.user;
        }),
      )
    );
  }

  public isLoggedIn(): boolean {
    return !!this.userToken;
  }

  public fetchCoreData(): Observable<any> {
    return forkJoin(
      this.fetchSettings(),
      this.fetchWatchTVShows(),
      this.fetchWatchTVEpisodes(),
      this.fetchWatchMovies(),
    );
  }

  public fetchSettings() {
    return this.http.get(this.API_URL_SETTINGS, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        if (data.length) {
          this.settings = data[0];
        } else {
          console.log('no settings');
        }
        return this.settings;
      }),
    );
  }

  public fetchUser(): Observable<any> {
    return this.http.get(this.API_URL_USER, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        if (data.length) {
          this.user = data[0];
          console.log('retrieved user', this.user);
          this.localStorage.setItem(this.STORAGE_KEY_USER, this.user).subscribe();
          return this.user;
        } else {
          console.log('no user');
          return null;
        }
      }),
    );
  }

  public login(user: string, pass: string) {
    const params = {
      username: user,
      password: pass,
    };
    return this.http.post(this.API_URL_LOGIN, params).pipe(
      map((data: any) => {
        console.log('token auth', data);
        this.userToken = data.token;
        this.localStorage.setItem(this.STORAGE_KEY_API_TOKEN, this.userToken).subscribe(
          (wasSet) => {
            console.log('local storage set', wasSet);
          },
          (error) => {
            console.error('local storage error', error);
          }
        );
        return data;
      }),
    );
  }

  public createSettings(params: any) {
    return this.http.post(this.API_URL_SETTINGS, params, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        console.log(data);
        this.settings = data;
        return this.settings;
      }),
    );
  }

  public updateSettings(id: number, params: any) {
    return this.http.put(`${this.API_URL_SETTINGS}${id}/`, params, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        console.log(data);
        this.settings = data;
        return this.settings;
      }),
    );
  }

  public searchTorrents(query: string, mediaType: string) {
    return this.http.get(`${this.API_URL_SEARCH_TORRENTS}?q=${query}&media_type=${mediaType}`, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        return data;
      }),
    );
  }

  public download(torrent: string) {
    return this.http.post(this.API_URL_DOWNLOAD_TORRENTS, {torrent: torrent}, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        return data;
      }),
    );
  }

  public searchMedia(query: string, mediaType: string) {
    return this.http.get(`${this.API_URL_SEARCH_MEDIA}?q=${query}&media_type=${mediaType}`, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        return data;
      }),
    );
  }

  public searchMediaDetail(mediaType: string, id: string) {
    return this.http.get(`${this.API_URL_SEARCH_MEDIA}${mediaType}/${id}/`, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        return data;
      }),
    );
  }

  public fetchWatchTVShows(params?: any) {
    params = params || {};
    const httpParams = new HttpParams({fromObject: params});
    return this.http.get(this.API_URL_WATCH_TV_SHOW, {params: httpParams, headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchTVShows = data;
        return this.watchTVShows;
      }),
    );
  }

  public fetchWatchMovie(id: number) {
    return this.http.get(`${this.API_URL_WATCH_MOVIE}${id}/`, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchMovies.forEach((watchMovie) => {
          if (data.id === watchMovie.id) {
            _.assign(watchMovie, data);
          }
        });
      })
    );
  }

  public fetchWatchMovies(params?: any) {
    params = params || {};
    const httpParams = new HttpParams({fromObject: params});

    return this.http.get(this.API_URL_WATCH_MOVIE, {params: httpParams, headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchMovies = data;
        return this.watchMovies;
      }),
    );
  }

  public fetchWatchTVEpisode(id: number) {
    return this.http.get(`${this.API_URL_WATCH_TV_EPISODE}${id}/`, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchTVEpisodes.forEach((watchTVEpisode) => {
          if (data.id === watchTVEpisode.id) {
            _.assign(watchTVEpisode, data);
          }
        });
      })
    );
  }

  public fetchWatchTVEpisodes() {
    return this.http.get(this.API_URL_WATCH_TV_EPISODE, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchTVEpisodes = data;
        return this.watchTVEpisodes;
      }),
    );
  }

  public fetchCurrentTorrents(torrentIds?: Number[]) {
    torrentIds = torrentIds || [];
    const httpParams = new HttpParams({fromObject: {ids: torrentIds.map((v) => String(v))}});
    return this.http.get(this.API_URL_CURRENT_TORRENTS, {headers: this._requestHeaders(), params: httpParams}).pipe(
      map((data: any) => {
        return data;
      }),
    );
  }

  public watchTVShow(showId: Number, name: String, posterImageUrl: String) {
    const params = {
      tmdb_show_id: showId,
      name: name,
      poster_image_url: posterImageUrl,
    };
    return this.http.post(this.API_URL_WATCH_TV_SHOW, params, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchTVShows.push(data);
        return data;
      }),
    );
  }

  public watchTVEpisode(watchShowId: Number, episodeId: Number, seasonNumber: Number, episodeNumber: Number) {
    const params = {
      watch_tv_show: watchShowId,
      tmdb_episode_id: episodeId,
      season_number: seasonNumber,
      episode_number: episodeNumber,
    };
    return this.http.post(this.API_URL_WATCH_TV_EPISODE, params, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchTVEpisodes.push(data);
        return data;
      }),
    );
  }

  public watchTVSeason(watchShowId: Number, seasonNumber: Number) {
    const params = {
      watch_tv_show: watchShowId,
      season_number: seasonNumber,
    };
    return this.http.post(`${this.API_URL_WATCH_TV_SHOW}${watchShowId}/entire-season/`, params, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchTVEpisodes = data;
        return data;
      }),
    );
  }

  public unWatchTVEpisode(watchId) {
    return this.http.delete(`${this.API_URL_WATCH_TV_EPISODE}${watchId}`, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        const foundIndex = _.findIndex(this.watchTVEpisodes, (watch) => {
          return watch.id === watchId;
        });
        if (foundIndex >= 0) {
          this.watchTVEpisodes.splice(foundIndex, 1);
        }
        return data;
      })
    );
  }

  public watchMovie(movieId: Number, name: String, posterImageUrl: String) {
    const params = {
      tmdb_movie_id: movieId,
      name: name,
      poster_image_url: posterImageUrl,
    };
    return this.http.post(this.API_URL_WATCH_MOVIE, params, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchMovies.push(data);
        return data;
      }),
    );
  }

  public unWatchMovie(watchId) {
    return this.http.delete(`${this.API_URL_WATCH_MOVIE}${watchId}`, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        const foundIndex = _.findIndex(this.watchMovies, (watch) => {
          return watch.id === watchId;
        });
        if (foundIndex >= 0) {
          this.watchMovies.splice(foundIndex, 1);
        }
        return data;
      })
    );
  }

  public verifySettings() {
    return this.http.get(`${this.API_URL_SETTINGS}${this.settings.id}/verify/`, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        return data;
      }),
    );
  }

  public blacklistRetryMovie(watchMediaId: number) {
    return this.http.post(`${this.API_URL_WATCH_MOVIE}${watchMediaId}/blacklist-auto-retry/`, null, {headers: this._requestHeaders()}).pipe(
      map((data: any) => {
        this.watchMovies.forEach((watchMovie) => {
          if (data.id === watchMovie.id) {
            _.assign(watchMovie, data);
          }
        });
        return data;
      }));
  }

}