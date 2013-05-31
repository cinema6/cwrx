cwrx
===

Cinema6 node utility framework

The cwrx (pronounced see-works) library is the node platform library used primarily by Cinema6 back-end applications, aka "the works".

The cwrx api provides the following sub-modules:
* __cwrx.assemble__ - Helper for concatenating a list of mp3s into a single mp3, including blank spaces between tracks
* __cwrx.ffmpeg__ - Wrappers for various ffmpeg utilities
* __cwrx.id3__ - Wrappers for id3v2 tools.
* __cwrx.logger__ - Handy console or file logging api, supports log rotation.
* __cwrx.vocalWare__ - Wrapper for the vocalware REST api

##Prerequisites

cwrx.ffmpeg and cwrx.assemble requires the ffmpeg command line application to have been previously installed on the target host.  The library makes use of ffmpeg and ffprobe.   Version 1.2 or above required.  While not required, the installation of the id3v2 tools is recommended to improve accuracy of the assemble module. Use of the optional vocalware module requires a valid vocalware account.

##Modules

cwrx provides several useful modules for working with audio and visual files and text to speech.

###cwrx.ffmpeg

The cwrx.ffmpeg library provides convenient wrappers and result checking for several ffmpeg functions.

__ffmpeg.concat__

Used to concatenate a list of mp3's into a single mp3 file.

__ffmpeg.mergeAudioToVideo__

Merges an audio file (mp3) into a video file.

__ffmpeg.makeSilentMP3__

Generates blank (silent) mp3 files up to 5 minutes in length.

__ffmpeg.probe__

Returns some basic information about a media file.

###cwrx.assemble

The cwrx.assemble library is a single function used to assemble a composite mp3.

###cwrx.vocalWare

The cwrx.vocalWare library provides convenient wrappers around the VocalWare RESTful API.

####Testing

By default, 'npm test' will exclude the VocalWare test specs.  In order to run the VocalWare unit tests the following command line must be given:

%> jasmine-node --config with-vocalware 1 --config vwauth vwauth.json test/vocalware.spec.js 

The vwauth.json file (name is optional) should contain the following, (replace 9's with your own ids):

{
    "apiId"       : "9999999",
    "accountId"   : "9999999",
    "secret"      : "99999999999999999999999999999999"
}
