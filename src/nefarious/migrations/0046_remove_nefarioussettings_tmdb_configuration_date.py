# Generated by Django 2.1.5 on 2019-10-20 20:53

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('nefarious', '0045_remove_nefarioussettings_jackett_indexers_seed'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='nefarioussettings',
            name='tmdb_configuration_date',
        ),
    ]