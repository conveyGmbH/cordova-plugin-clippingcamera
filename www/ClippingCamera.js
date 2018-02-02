
    var argscheck = require('cordova/argscheck'),
        exec = require("cordova/exec");

/**
 * Optional parameters to customize the clipping camera settings.
 * * [Quirks](#CameraOptions-quirks)
 * @typedef module:clippingCamera.CameraOptions
 * @type {Object}
 * @property {number} [quality=100] - Quality of the saved image, expressed as a range of 0-100, where 100 is typically full resolution with no loss from file compression. (Note that information about the camera's resolution is unavailable.)
 * @property {Boolean} [convertToGrayscale=false] - converts the saved image to grayscale.
 * @property {Boolean} [dontClip=false] - iOS-only, supress automatic clipping detection
 */

    var clippingCamera = {
        getPicture: function(success, failure, options){
            argscheck.checkArgs('fFO', 'ClippingCamera.getPicture', arguments);
            options = options || {};
            var getValue = argscheck.getValue;

            var quality = getValue(options.quality, 100);
            var convertToGrayscale = !!options.convertToGrayscale;
            var dontClip = !!options.dontClip;
            var maxResolution = options.maxResolution;
            var aspectRatio = options.aspectRatio;
            var autoShutter = options.autoShutter;

            var args = [quality, convertToGrayscale, dontClip, maxResolution, aspectRatio, autoShutter];

            exec(success, failure, "ClippingCamera", "openCamera", args);
        }
    };
    module.exports = clippingCamera;

