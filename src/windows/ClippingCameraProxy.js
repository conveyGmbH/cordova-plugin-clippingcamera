/*
 * Copyright (c) Microsoft Open Technologies, Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

var urlutil = require('cordova/urlutil');

var CAMERA_STREAM_STATE_CHECK_RETRY_TIMEOUT = 200; // milliseconds
var OPERATION_IS_IN_PROGRESS = -2147024567;
var REGDB_E_CLASSNOTREG = -2147221164;
var INITIAL_FOCUS_DELAY = 200; // milliseconds
var CHECK_PLAYING_TIMEOUT = 100; // milliseconds

var getAppData = function () {
    return Windows.Storage.ApplicationData.current;
};
var encodeToBase64String = function (buffer) {
    return Windows.Security.Cryptography.CryptographicBuffer.encodeToBase64String(buffer);
};
var OptUnique = Windows.Storage.CreationCollisionOption.generateUniqueName;
var fileIO = Windows.Storage.FileIO;

/**
 * Detects the first appropriate camera located at the back panel of device. If
 *   there is no back cameras, returns the first available.
 *
 * @returns {Promise<String>} Camera id
 */
function findCamera() {
    var Devices = Windows.Devices.Enumeration;

    // Enumerate cameras and add them to the list
    return Devices.DeviceInformation.findAllAsync(Devices.DeviceClass.videoCapture)
    .then(function (cameras) {

        if (!cameras || cameras.length === 0) {
            throw new Error("No cameras found");
        }

        var backCameras = cameras.filter(function (camera) {
            return camera.enclosureLocation && camera.enclosureLocation.panel === Devices.Panel.back;
        });

        // If there is back cameras, return the id of the first,
        // otherwise take the first available device's id
        return (backCameras[0] || cameras[0]).id;
    });
}

/**
 * @param {Windows.Graphics.Display.DisplayOrientations} displayOrientation
 * @return {Number}
 */
function videoPreviewRotationLookup(displayOrientation, isMirrored) {
    var degreesToRotate;

    switch (displayOrientation) {
        case Windows.Graphics.Display.DisplayOrientations.landscape:
            degreesToRotate = 0;
            break;
        case Windows.Graphics.Display.DisplayOrientations.portrait:
            if (isMirrored) {
                degreesToRotate = 270;
            } else {
                degreesToRotate = 90;
            }
            break;
        case Windows.Graphics.Display.DisplayOrientations.landscapeFlipped:
            degreesToRotate = 180;
            break;
        case Windows.Graphics.Display.DisplayOrientations.portraitFlipped:
            if (isMirrored) {
                degreesToRotate = 90;
            } else {
                degreesToRotate = 270;
            }
            break;
        default:
            degreesToRotate = 0;
            break;
    }

    return degreesToRotate;
}

    /**
     * Converts SimpleOrientation to a VideoRotation to remove difference between camera sensor orientation
     * and video orientation
     * @param  {number} orientation - Windows.Devices.Sensors.SimpleOrientation
     * @return {number} - Windows.Media.Capture.VideoRotation
     */
    function orientationToRotation(orientation) {
        // VideoRotation enumerable and BitmapRotation enumerable have the same values
        // https://msdn.microsoft.com/en-us/library/windows/apps/windows.media.capture.videorotation.aspx
        // https://msdn.microsoft.com/en-us/library/windows/apps/windows.graphics.imaging.bitmaprotation.aspx

        switch (orientation) {
            // portrait
        case Windows.Devices.Sensors.SimpleOrientation.notRotated:
            return Windows.Media.Capture.VideoRotation.clockwise90Degrees;
        // landscape
        case Windows.Devices.Sensors.SimpleOrientation.rotated90DegreesCounterclockwise:
            return Windows.Media.Capture.VideoRotation.none;
        // portrait-flipped (not supported by WinPhone Apps)
        case Windows.Devices.Sensors.SimpleOrientation.rotated180DegreesCounterclockwise:
            // Falling back to portrait default
            return Windows.Media.Capture.VideoRotation.clockwise90Degrees;
        // landscape-flipped
        case Windows.Devices.Sensors.SimpleOrientation.rotated270DegreesCounterclockwise:
            return Windows.Media.Capture.VideoRotation.clockwise180Degrees;
        // faceup & facedown
        default:
            // Falling back to portrait default
            return Windows.Media.Capture.VideoRotation.clockwise90Degrees;
        }
    }


/**
 * The implementation of camera user interface
 *
 * @class {CameraUI}
 */
function CameraUI () {
    this._promise = null;
    this._cancelled = false;
    this._captured = false;
    this._props = new Windows.Foundation.Collections.PropertySet();
    this._props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E70}", 50);
    this._props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E71}", false);
    this._props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E72}", 0);
    this._props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E79}", false);
    this._props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E80}", "");
}

/**
 * Returns an instance of CameraUI
 *
 * @static
 * @constructs {CameraUI}
 *
 * @param   {MediaCapture}   mediaCaptureInstance  Instance of
 *   Windows.Media.Capture.MediaCapture class
 *
 * @return  {CameraUI}  CameraUI instance that could be used for
 *   capturing photos
 */
CameraUI.get = function () {
    return new CameraUI();
};

/**
 * Initializes instance of camera.
 *
 * @param   {MediaCapture}  capture  Instance of
 *   Windows.Media.Capture.MediaCapture class, used for acquiring images/ video stream
 *
 * @param   {Number}  width    Video/image frame width
 * @param   {Number}  height   Video/image frame height
 */
CameraUI.prototype.init = function (capture, width, height, fail) {
    this._capture = capture;
    this._width = width;
    this._height = height;
    this._fail = fail;
};



/**
 * Starts capture asyncronously.
 *
 * @return  {Promise<ScanResult>}  barcode scan result or null if search
 *   cancelled.
 */
CameraUI.prototype.capturing = function (bDontClip) {

    /**
     * Checks for result from media filter. If there is no result
     *   found, returns null.
     */
    function checkForResult(capture, propertySet, captured, fail) {
        return WinJS.Promise.timeout(200).then(function () {
            return new WinJS.Promise(function (complete) {
                if (!bDontClip) {
                    var value = null;
                    if (propertySet && captured) {
                        try {
                            var key = "{698649BE-8EAE-4551-A4CB-2FA79A4E1E80}";
                            value = propertySet.lookup(key);
                            if (value && !value.length) {
                                value = null;
                            }
                        } catch (e) {
                            console.error('propertySet.lookup failed: ' + e);
                        }
                    }
                    complete(value);
                    return WinJS.Promise.as();
                } else if (capture && captured) {
                    var fileName = "photo.jpg";
                    var tempFolder = getAppData().temporaryFolder;
                    return tempFolder.createFileAsync(fileName, OptUnique).then(function(tempCapturedFile) {
                        if (!tempCapturedFile) {
                            return WinJS.Promise.as();
                        }
                        return new WinJS.Promise(function(complete) {
                            var encodingProperties = Windows.Media.MediaProperties.ImageEncodingProperties.createJpeg();
                            var photoStream = new Windows.Storage.Streams.InMemoryRandomAccessStream();
                            var finalStream = new Windows.Storage.Streams.InMemoryRandomAccessStream();
                            return capture.capturePhotoToStreamAsync(encodingProperties, photoStream).then(function() {
                                return Windows.Graphics.Imaging.BitmapDecoder.createAsync(photoStream);
                            }).then(function(dec) {
                                finalStream.size = 0; // BitmapEncoder requires the output stream to be empty
                                return Windows.Graphics.Imaging.BitmapEncoder.createForTranscodingAsync(finalStream,
                                    dec);
                            }).then(function(enc) {
                                var displayInformation =
                                    Windows.Graphics.Display.DisplayInformation.getForCurrentView();
                                var currentOrientation = displayInformation.currentOrientation;

                                // We need to rotate the photo wrt sensor orientation
                                enc.bitmapTransform.rotation = orientationToRotation(currentOrientation);
                                return enc.flushAsync();
                            }).then(function() {
                                return tempCapturedFile.openAsync(Windows.Storage.FileAccessMode.readWrite);
                            }).then(function(fileStream) {
                                return Windows.Storage.Streams.RandomAccessStream.copyAndCloseAsync(finalStream,
                                    fileStream);
                            }).done(function() {
                                photoStream.close();
                                finalStream.close();
                                complete(tempCapturedFile);
                            },
                            function() {
                                photoStream.close();
                                finalStream.close();
                                throw new Error("An error has occured while capturing the photo.");
                            });
                        });
                    }).then(function(capturedFile) {
                        return new WinJS.Promise(function(complete) {
                            if (!capturedFile) {
                                complete(null);
                                return WinJS.Promise.as();
                            } else {
                                return fileIO.readBufferAsync(capturedFile).done(function(buffer) {
                                    var strBase64 = encodeToBase64String(buffer);
                                    capturedFile.deleteAsync().done(function() {
                                        complete(strBase64);
                                    },
                                    function(err) {
                                        fail(err);
                                    });
                                },fail);
                            }
                        });
                    });
                } else {
                    return WinJS.Promise.as();
                }
            });
        });
    }

    var that = this;
    return checkForResult(this._capture, this._props, this._captured, this._fail).then(function (result) {
        if (that._cancelled)
            return null;

        return result || (that._promise = that.capturing());
    });
};

CameraUI.prototype.captured = function () {
    this._captured = true;
};


/**
 * Stops camera capture
 */
CameraUI.prototype.stop = function () {
    this._cancelled = true;
};

function degreesToRotation(degrees) {
    switch (degrees) {
        // portrait
        case 90:
            return Windows.Media.Capture.VideoRotation.clockwise90Degrees;
        // landscape
        case 0:
            return Windows.Media.Capture.VideoRotation.none;
        // portrait-flipped
        case 270:
            return Windows.Media.Capture.VideoRotation.clockwise270Degrees;
        // landscape-flipped
        case 180:
            return Windows.Media.Capture.VideoRotation.clockwise180Degrees;
        default:
            // Falling back to portrait default
            return Windows.Media.Capture.VideoRotation.clockwise90Degrees;
    }
}

module.exports = {

    /**
     * Opens preview via device camera and retieves photo from it.
     * @param  {function} success Success callback
     * @param  {function} fail    Error callback
     * @param  {array} args       Arguments array
     * args will contain :
     *  ...  it is an array, so be careful
     * 0 quality:0..100,
     * 1 convertToGrayscale:true|false,
     * 2 dontClip:true|false
     */
    openCamera: function (success, fail, args) {
        var capturePreview,
            capturePreviewFrame,
            navigationButtonsDiv,
            previewMirroring,
            debugText,
            closeButton,
            settingsButton,
            photoButton,
            capture,
            camera,
            videoProps,
            cancelPromise;

        // Save call state for suspend/resume
        CameraUI.openCameraCallArgs = {
            success: success,
            fail: fail,
            args: args
        };
        function getQuality() {
            return CameraUI.openCameraCallArgs.args && CameraUI.openCameraCallArgs.args[0];
        }
        function getConvertToGrayscale() {
            return CameraUI.openCameraCallArgs.args && CameraUI.openCameraCallArgs.args[1];
        }
        function getDontClip() {
            return CameraUI.openCameraCallArgs.args && CameraUI.openCameraCallArgs.args[2];
        }
        function getMaxResolution() {
            return CameraUI.openCameraCallArgs.args && CameraUI.openCameraCallArgs.args[3];
        }
        function getAspectRatio() {
            var aspectRatio =  0.0;
            if (CameraUI.openCameraCallArgs.args &&
                CameraUI.openCameraCallArgs.args[4]) {
                var strAspectRatio = CameraUI.openCameraCallArgs.args[4];
                if (typeof strAspectRatio === "string") {
                    var pos = strAspectRatio.indexOf("/");
                    if (pos > 0) {
                        var width = parseInt(strAspectRatio.substr(0, pos));
                        var height = parseInt(strAspectRatio.substr(pos + 1));
                        if (width && height) {
                            aspectRatio = width / height;
                        }
                    }
                }
            }
            return aspectRatio;
        }
        function getAutoShutter() {
            return CameraUI.openCameraCallArgs.args && CameraUI.openCameraCallArgs.args[5];
        }
        function getAppBarSize() {
            if (CameraUI.openCameraCallArgs.args && CameraUI.openCameraCallArgs.args[6]) {
                if (typeof CameraUI.openCameraCallArgs.args[6] === "string") {
                    return parseInt(CameraUI.openCameraCallArgs.args[6]);
                }
                return CameraUI.openCameraCallArgs.args[6];
            }
            return null;
        }
        function getAppBarText() {
            if (CameraUI.openCameraCallArgs.args && CameraUI.openCameraCallArgs.args[7]) {
                return CameraUI.openCameraCallArgs.args[7];
            }
            return null;
        }
        function getRotationDegree() {
            if (CameraUI.openCameraCallArgs.args && CameraUI.openCameraCallArgs.args[8]) {
                return CameraUI.openCameraCallArgs.args[8];
            }
            return null;
        }

        function updatePreviewForRotation(evt) {
            var resizeLater = function() {
                WinJS.Promise.timeout(50).then(function() {
                    resizePreview();
                });
                return WinJS.Promise.as();
            }
            if (!capture) {
                return resizeLater();
            }
            var displayInformation = (evt && evt.target) || Windows.Graphics.Display.DisplayInformation.getForCurrentView();
            var currentOrientation = displayInformation.currentOrientation;

            previewMirroring = capture.getPreviewMirroring();

            // Lookup up the rotation degrees.
            var rotDegree = videoPreviewRotationLookup(currentOrientation, previewMirroring);

            var rotAdd = getRotationDegree();
            if (rotAdd) {
                rotDegree = (rotDegree + rotAdd) % 360;
            }

            capture.setPreviewRotation(degreesToRotation(rotDegree));
            return resizeLater();
        }
        function clickPreview() {
            focus();
        }
        function resizePreview() {
            var width = document.body.clientWidth;
            var height = document.body.clientHeight;
            if (capturePreviewFrame && capturePreviewFrame.style) {
                capturePreviewFrame.style.width = width.toString() + "px";
                capturePreviewFrame.style.height = height.toString() + "px";
                reposition(width, height);
            }
        }

        /**
         * Creates a preview frame and necessary objects
         */
        function createPreview() {

            // Create fullscreen preview
            var capturePreviewFrameStyle = document.createElement("link");
            capturePreviewFrameStyle.rel = "stylesheet";
            capturePreviewFrameStyle.type = "text/css";
            capturePreviewFrameStyle.href = urlutil.makeAbsolute("/www/css/plugin-clippingCamera.css");

            document.head.appendChild(capturePreviewFrameStyle);

            capturePreviewFrame = document.createElement("div");
            capturePreviewFrame.className = "camera-ui-wrap";

            capturePreview = document.createElement("video");
            capturePreview.className = "camera-ui-preview";
            capturePreview.addEventListener("click", clickPreview, false);
            window.addEventListener("resize", resizePreview, false);

            navigationButtonsDiv = document.createElement("div");
            navigationButtonsDiv.className = "camera-ui-app-bar";
            navigationButtonsDiv.onclick = function (e) {
                e.cancelBubble = true;
            };

            closeButton = document.createElement("span");
            closeButton.className = "app-bar-action action-close";
            navigationButtonsDiv.appendChild(closeButton);

            var appBarText = getAppBarText();
            if (appBarText) {
                var actionText = document.createElement("span");
                actionText.className = "app-bar-action action-text";
                actionText.innerHTML = appBarText;
                navigationButtonsDiv.appendChild(actionText);
            }

            photoButton = document.createElement("span");
            photoButton.className = "app-bar-action action-photo";
            navigationButtonsDiv.appendChild(photoButton);

            //settingsButton = document.createElement("span");
            //settingsButton.className = "app-bar-action action-settings";
            //navigationButtonsDiv.appendChild(settingsButton);

            CameraUI.captureCancelled = false;
            closeButton.addEventListener("click", cancelPreview, false);
            document.addEventListener("backbutton", cancelPreview, true);

            photoButton.addEventListener("click", capturePhoto, false);

            if (getAutoShutter()) {
                cancelPromise = WinJS.Promise.timeout(60000).then(cancelPreview);
            }
            var appBarSize = getAppBarSize();
            if (appBarSize && appBarSize > 48) {
                if (navigationButtonsDiv.style) {
                    navigationButtonsDiv.style.height = appBarSize.toString() + "px";
                }
                var appBarActionSize = appBarSize - 8;
                var appBarFontSize = appBarActionSize - 22;
                if (closeButton.style) {
                    closeButton.style.height = appBarActionSize.toString() + "px";
                    closeButton.style.fontSize = appBarFontSize.toString() + "px";
                }
                if (photoButton.style) {
                    photoButton.style.height = appBarActionSize.toString() + "px";
                    photoButton.style.fontSize = appBarFontSize.toString() + "px";
                }
                //if (settingsButton.style) {
                //    settingsButton.style.height = appBarSize.toString() + "px";
                //    settingsButton.style.fontSize = appBarFontSize.toString() + "px";
                //}
            }

            [capturePreview, navigationButtonsDiv].forEach(function (element) {
                capturePreviewFrame.appendChild(element);
            });
        }

        function addEffectToImageStream(bDoCapture) {
            if (camera) {
                var props = camera._props;
                var rotation = getRotationDegree();
                if (rotation) {
                    rotation = 360 - (rotation % 360);
                } else {
                    rotation = 0;
                }

                props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E70}", getQuality());
                props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E71}", getConvertToGrayscale());
                props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E72}", rotation);

                props.insert("{698649BE-8EAE-4551-A4CB-2FA79A4E1E79}", bDoCapture);

                return capture.clearEffectsAsync(Windows.Media.Capture.MediaStreamType.videoPreview).then(function() {
                    if (!getDontClip()) {
                        return capture.addEffectAsync(Windows.Media.Capture.MediaStreamType.videoPreview,
                            'ClippingCamera.ImageClipping',
                            props);
                    } else {
                        return null;
                    }
                });
            } else {
                return WinJS.Promise.as();
            }
        };

        function reposition(widthFrame, heightFrame) {
            if (capturePreviewFrame && capturePreview && capturePreview.style) {
                var displayInformation = Windows.Graphics.Display.DisplayInformation.getForCurrentView();

                var currentOrientation = displayInformation.currentOrientation;
                // Lookup up the rotation degrees.
                var rotDegree = videoPreviewRotationLookup(currentOrientation, previewMirroring);
                var rotAdd = getRotationDegree();
                if (rotAdd) {
                    rotDegree = (rotDegree + rotAdd) % 360;
                }

                var videoWidth = videoProps.width;
                var videoHeight = videoProps.height;
                if (videoWidth > 0 && videoHeight > 0) {
                    var width, height;
                    switch (rotDegree) {
                    case 90:
                    case 270:
                        width = 2 * widthFrame;
                        height = Math.floor(width * videoWidth / videoHeight);
                        break;
                    default:
                        height = heightFrame;
                        width = Math.floor(heightFrame * videoWidth / videoHeight);
                    }
                    var left = Math.floor((widthFrame - width) / 2);
                    var top = Math.floor((heightFrame - height) / 2);

                    if (heightFrame > 0 && height > 0) {
                        //console.log("width=" + width + " height=" + height + " left=" + left + " top=" + top);
                        capturePreview.style.left = left.toString() + "px";
                        capturePreview.style.top = top.toString() + "px";
                        capturePreview.style.width = width.toString() + "px";
                        capturePreview.style.height = height.toString() + "px";
                    }
                }
            }
        }

        function focus(controller) {

            var result = WinJS.Promise.wrap();

            if (!capturePreview || capturePreview.paused) {
                // If the preview is not yet playing, there is no sense in running focus
                return result;
            }

            if (!controller) {
                try {
                    controller = capture && capture.videoDeviceController;
                } catch (err) {
                    console.log('Failed to access focus control for current camera: ' + err);
                    return result;
                }
            }

            if (!controller.focusControl || !controller.focusControl.supported) {
                console.log('Focus control for current camera is not supported');
                return result;
            }

            // Multiple calls to focusAsync leads to internal focusing hang on some Windows Phone 8.1 devices
            // Also need to wrap in try/catch to avoid crash on Surface 3 - looks like focusState property
            // somehow is not accessible there.
            try {
                if (controller.focusControl.focusState === Windows.Media.Devices.MediaCaptureFocusState.searching) {
                    return result;
                }
            } catch (e) {
                // Nothing to do - just continue w/ focusing
            }

            // The delay prevents focus hang on slow devices
            return WinJS.Promise.timeout(INITIAL_FOCUS_DELAY)
            .then(function () {
                try {
                    return controller.focusControl.focusAsync().then(function () {
                        return result;
                    }, function (e) {
                        // This happens on mutliple taps
                        if (e.number !== OPERATION_IS_IN_PROGRESS) {
                            console.error('focusAsync failed: ' + e);
                            return WinJS.Promise.wrapError(e);
                        }
                        return result;
                    });
                } catch (e) {
                    // This happens on mutliple taps
                    if (e.number !== OPERATION_IS_IN_PROGRESS) {
                        console.error('focusAsync failed: ' + e);
                        return WinJS.Promise.wrapError(e);
                    }
                    return result;
                }
            });
        }

        function setupFocus(focusControl) {

            function supportsFocusMode(mode) {
                return focusControl.supportedFocusModes.indexOf(mode).returnValue;
            }

            if (!focusControl || !focusControl.supported || !focusControl.configure) {
                return WinJS.Promise.wrap();
            }

            var FocusMode = Windows.Media.Devices.FocusMode;
            var focusConfig = new Windows.Media.Devices.FocusSettings();
            focusConfig.autoFocusRange = Windows.Media.Devices.AutoFocusRange.normal;

            // Determine a focus position if the focus search fails:
            focusConfig.disableDriverFallback = false;

            if (supportsFocusMode(FocusMode.continuous)) {
                console.log("Device supports continuous focus mode");
                focusConfig.mode = FocusMode.continuous;
            } else if (supportsFocusMode(FocusMode.auto)) {
                console.log("Device doesn\'t support continuous focus mode, switching to autofocus mode");
                focusConfig.mode = FocusMode.auto;
            }

            focusControl.configure(focusConfig);

            // Continuous focus should start only after preview has started. See 'Remarks' at
            // https://msdn.microsoft.com/en-us/library/windows/apps/windows.media.devices.focuscontrol.configure.aspx
            function waitForIsPlaying() {
                var isPlaying = !capturePreview.paused && !capturePreview.ended && capturePreview.readyState > 2;

                if (!isPlaying) {
                    return WinJS.Promise.timeout(CHECK_PLAYING_TIMEOUT)
                    .then(function () {
                        return waitForIsPlaying();
                    });
                }
                return focus();
            }

            return waitForIsPlaying();
        }

        function disableZoomAndScroll() {
            document.body.classList.add('no-zoom');
            document.body.classList.add('no-scroll');
        }

        function enableZoomAndScroll() {
            document.body.classList.remove('no-zoom');
            document.body.classList.remove('no-scroll');
        }

        /**
         * Starts stream transmission to preview frame and then run barcode search
         */
        function startPreview() {
            return findCamera()
            .then(function (id) {
                var captureSettings;
                try {
                    captureSettings = new Windows.Media.Capture.MediaCaptureInitializationSettings();
                } catch (e) {
                    if (e.number === REGDB_E_CLASSNOTREG) {
                        throw new Error('Ensure that you have Windows Media Player and Media Feature pack installed.');
                    }

                    throw e;
                }
                captureSettings.streamingCaptureMode = Windows.Media.Capture.StreamingCaptureMode.video;
                captureSettings.videoDeviceId = id;
                captureSettings.photoCaptureSource = Windows.Media.Capture.PhotoCaptureSource.auto;

                capture = new Windows.Media.Capture.MediaCapture();
                return capture.initializeAsync(captureSettings);
            })
            .then(function () {

                var controller = capture.videoDeviceController;
                //var videoProps = controller.getMediaStreamProperties(Windows.Media.Capture.MediaStreamType.videoPreview);

                var deviceProps = controller.getAvailableMediaStreamProperties(Windows.Media.Capture.MediaStreamType.videoPreview);
                deviceProps = Array.prototype.slice.call(deviceProps);
                deviceProps = deviceProps.filter(function (prop) {
                    // filter out streams with "unknown" subtype - causes errors on some devices
                    return prop.subtype !== "Unknown";
                }).sort(function (propA, propB) {
                    // sort properties by resolution
                    return propB.width * propB.height - propA.width * propA.height;
                });
                var i;
                for (i = 0; i < deviceProps.length; i++) {
                    console.log("deviceProps[" + i + "]: width=" + deviceProps[i].width + " height=" + deviceProps[i].height + " ratio=" + deviceProps[i].width / deviceProps[i].height +
                        " frameRate=" + deviceProps[i].frameRate.denominator + "/" + deviceProps[i].frameRate.numerator);
                }

                var aspectRatio = getAspectRatio();
                var maxResolution = getMaxResolution() || 5000000;
                console.log("aspectRatio=" + aspectRatio + " aspectRatio=" + aspectRatio);
                var preferredProps = deviceProps.filter(function (prop) {
                    var bUse = false;
                    // Filter out props whith desired max res and aspect ratio
                    if (prop.width && prop.height) {
                        var area = prop.width * prop.height;
                        if (area <= maxResolution && (!aspectRatio || (prop.width / prop.height === aspectRatio))) {
                            bUse = true;
                        }
                    }
                    return bUse;
                });
                for (i = 0; i < preferredProps.length; i++) {
                    console.log("preferredProps[" + i + "]: width=" + preferredProps[i].width + " height=" + preferredProps[i].height + " ratio=" + preferredProps[i].width / preferredProps[i].height);
                }

                // use maximum resolution otherwise
                videoProps = preferredProps[0] || deviceProps[0];
                console.log("videoProps.width=" + videoProps.width + " height=" + videoProps.height);

                return controller.setMediaStreamPropertiesAsync(Windows.Media.Capture.MediaStreamType.videoPreview, videoProps)
                .then(function () {
                    return {
                        capture: capture,
                        width: videoProps.width,
                        height: videoProps.height
                    };
                });
            })
            .then(function (captureSettings) {

                capturePreview.msZoom = true;
                capturePreview.src = URL.createObjectURL(capture);
                capturePreview.play();

                // Insert preview frame and controls into page
                document.body.appendChild(capturePreviewFrame);

                resizePreview();
                disableZoomAndScroll();

                return setupFocus(captureSettings.capture.videoDeviceController.focusControl)
                .then(function () {
                    Windows.Graphics.Display.DisplayInformation.getForCurrentView().addEventListener("orientationchanged", updatePreviewForRotation, false);
                    return updatePreviewForRotation();
                })
                .then(function () {
                    if (!Windows.Media.Devices.CameraStreamState) {
                        // CameraStreamState is available starting with Windows 10 so skip this check for 8.1
                        // https://msdn.microsoft.com/en-us/library/windows/apps/windows.media.devices.camerastreamstate
                        return WinJS.Promise.as();
                    }
                    function checkCameraStreamState() {
                        if (capture.cameraStreamState !== Windows.Media.Devices.CameraStreamState.streaming) {
                            // Using loop as MediaCapture.CameraStreamStateChanged does not fire with CameraStreamState.streaming state.
                            return WinJS.Promise.timeout(CAMERA_STREAM_STATE_CHECK_RETRY_TIMEOUT)
                            .then(function () {
                                return checkCameraStreamState();
                            });
                        }
                        return WinJS.Promise.as();
                    }
                    // Ensure CameraStreamState is Streaming
                    return checkCameraStreamState();
                })
                .then(function () {
                    WinJS.Promise.timeout(CHECK_PLAYING_TIMEOUT).then(function () {
                        resizePreview();
                        if (getAutoShutter()) {
                            WinJS.Promise.timeout(getAutoShutter()).then(function () {
                                if (photoButton && photoButton.style) {
                                    photoButton.style.display = "none";
                                }
                                capturePhoto();
                            });
                        }
                    });
                    return captureSettings;
                });
            });
        }

        /**
         * Removes preview frame and corresponding objects from window
         */
        function destroyPreview() {
            if (cancelPromise) {
                cancelPromise.cancel();
                cancelPromise = null;
            }
            var promise = WinJS.Promise.as();

            Windows.Graphics.Display.DisplayInformation.getForCurrentView().removeEventListener("orientationchanged", updatePreviewForRotation, false);
            document.removeEventListener("backbutton", cancelPreview);

            if (capturePreview) {
                var isPlaying = !capturePreview.paused && !capturePreview.ended && capturePreview.readyState > 2;
                if (isPlaying) {
                    capturePreview.pause();
                }

                // http://stackoverflow.com/a/28060352/4177762
                capturePreview.src = "";
                if (capturePreview.load) {
                    capturePreview.load();
                }
                window.removeEventListener("resize", resizePreview);
                capturePreview.removeEventListener("click", clickPreview);
            }
            if (closeButton) {
                closeButton.removeEventListener("click", cancelPreview);
            }
            if (photoButton) {
                photoButton.removeEventListener("click", capturePhoto);
            }

            if (capturePreviewFrame) {
                try {
                    document.body.removeChild(capturePreviewFrame);
                } catch (e) {
                    // Catching NotFoundError
                    console.error(e);
                }
            }
            capturePreviewFrame = null;

            camera && camera.stop();
            camera = null;

            if (capture) {
                try {
                    promise = capture.stopRecordAsync();
                } catch (e) {
                    // Catching NotFoundError
                    console.error(e);
                }
            }
            capture = null;

            enableZoomAndScroll();

            return promise;
        }

        /**
         * Stops preview and then call success callback with cancelled=true
         */
        function cancelPreview() {
            CameraUI.captureCancelled = true;
            camera && camera.stop();
        }

        function capturePhoto() {
            addEffectToImageStream(true);
            camera && camera.captured();
        }

        function checkCancelled() {
            if (CameraUI.captureCancelled || CameraUI.suspended) {
                throw new Error('Canceled');
            }
        }

        // Timeout is needed so that the .done finalizer below can be attached to the promise.
        CameraUI.capturePromise = WinJS.Promise.timeout()
        .then(function() {
            createPreview();
            checkCancelled();
            return startPreview();
        })
        .then(function (captureSettings) {
            checkCancelled();
            camera = CameraUI.get();
            camera.init(captureSettings.capture, captureSettings.width, captureSettings.height, fail);

            // Add a small timeout before capturing first frame otherwise
                return WinJS.Promise.timeout(200);
            })
        .then(function () {
            checkCancelled();
            return addEffectToImageStream(false);
        })
        .then(function () {
            checkCancelled();
            return camera.capturing(getDontClip());
        })
        .then(function (result) {
            // Suppress null result (cancel) on suspending
            if (CameraUI.suspended) {
                return;
            }
            checkCancelled();

            destroyPreview();
            success(result);
        });

        // Catching any errors here
        CameraUI.capturePromise.done(function () { }, function (error) {
            // Suppress null result (cancel) on suspending
            if (CameraUI.suspended) {
                return;
            }

            destroyPreview();
            fail(error);
        });

        CameraUI.videoPreviewIsVisible = function () {
            return capturePreviewFrame !== null;
        }

        CameraUI.destroyPreview = destroyPreview;
    }
};

var app = WinJS.Application;

function waitForCaptureEnd() {
    return CameraUI.capturePromise || WinJS.Promise.as();
}

function suspend(args) {
    CameraUI.suspended = true;
    if (args) {
        args.setPromise(CameraUI.destroyPreview()
        .then(waitForCaptureEnd, waitForCaptureEnd));
    } else {
        CameraUI.destroyPreview();
    }
}

function resume() {
    CameraUI.suspended = false;
    module.exports.openCamera(CameraUI.openCameraCallArgs.success, CameraUI.openCameraCallArgs.fail, CameraUI.openCameraCallArgs.args);
}

function onVisibilityChanged() {
    if (document.visibilityState === 'hidden'
        && CameraUI.videoPreviewIsVisible && CameraUI.videoPreviewIsVisible() && CameraUI.destroyPreview) {
        suspend();
    } else if (CameraUI.suspended) {
        resume();
    }
}

// Windows 8.1 projects
document.addEventListener('msvisibilitychange', onVisibilityChanged);
// Windows 10 projects
document.addEventListener('visibilitychange', onVisibilityChanged);

// About to be suspended
app.addEventListener('checkpoint', function (args) {
    if (CameraUI.videoPreviewIsVisible && CameraUI.videoPreviewIsVisible() && CameraUI.destroyPreview) {
        suspend(args);
    }
});

// Resuming from a user suspension
Windows.UI.WebUI.WebUIApplication.addEventListener("resuming", function () {
    if (CameraUI.suspended) {
        resume();
    }
}, false);

require("cordova/exec/proxy").add("ClippingCamera", module.exports);
