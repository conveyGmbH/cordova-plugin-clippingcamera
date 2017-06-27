//
//  ClippingCamera.mm
//  BusiCdAutoClip
//
//  Created by Manfred Wühr on 23.06.17.
//
//

#import "ClippingCamera.h"

@implementation ClippingCamera

// Cordova command method
-(void) openCamera:(CDVInvokedUrlCommand *)command {
    self.hasPendingOperation = YES;
    
    // Save the CDVInvokedUrlCommand as a property.  We will need it later.
    self.latestCommand = command;
    
    // Make the overlay view controller.
    self.theCameraViewController = [[ClippingCameraViewController alloc] initWithNibName:@"ClippingCameraViewController" bundle:nil];
    self.theCameraViewController.plugin = self;
    
    // Display the view.  This will "slide up" a modal view from the bottom of the screen.
    [self.viewController presentViewController:self.theCameraViewController animated:YES completion:nil];
}

// Method called by the CameraViewController when the image is ready to be sent back to the web view
-(void) returnCapturedImage:(NSString*)base64Image {
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsString:base64Image] callbackId:self.latestCommand.callbackId];
    
    self.hasPendingOperation = NO;
    
    // Hide the picker view
    [self.viewController dismissViewControllerAnimated:YES completion:nil];
}

@end
