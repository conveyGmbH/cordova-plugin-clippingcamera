
    var exec = require("cordova/exec");

    var clippingCamera = {
        getPicture: function(success, failure){
            exec(success, failure, "ClippingCamera", "openCamera", []);
        }
    };
    module.exports = clippingCamera;

