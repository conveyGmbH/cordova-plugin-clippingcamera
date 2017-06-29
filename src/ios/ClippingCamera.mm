//
//  ClippingCamera.mm
//  BusiCdAutoClip
//
//  Created by Manfred Wühr on 23.06.17.
//
//

#import "ClippingCamera.h"

@implementation ClippingCamera

@synthesize hasPendingOperation;

// Cordova command method
-(void) openCamera:(CDVInvokedUrlCommand *)command {
    self.hasPendingOperation = YES;
    
    // Save the CDVInvokedUrlCommand as a property.  We will need it later.
    self.latestCommand = command;
    
    // Make the overlay view controller.
    self.theCameraViewController = [[ClippingCameraViewController alloc] initWithNibName:@"ClippingCameraViewController" bundle:nil];
    self.theCameraViewController.pictureQuality = [command argumentAtIndex:0 withDefault:@(100)];
    self.theCameraViewController.plugin = self;
    
    // Display the view.  This will "slide up" a modal view from the bottom of the screen.
    [self.viewController presentViewController:self.theCameraViewController animated:YES completion:nil];
}

// Method called by the CameraViewController when the image is ready to be sent back to the web view
-(void) returnCapturedImage:(NSString*)base64Image {
    [self realReturn:base64Image withStatus:CDVCommandStatus_OK];
}

// Method called by the CameraViewController when operation got cancelled
-(void) returnWithError:(NSString*)errorString {
    [self realReturn:errorString withStatus:CDVCommandStatus_ERROR];
}


#pragma mark - private

-(void) realReturn:(NSString*)theString withStatus:(CDVCommandStatus)theStatus {
    __weak ClippingCamera* weakSelf = self;
    
    dispatch_block_t theRest = ^ (void) {
        CDVPluginResult* result = [CDVPluginResult resultWithStatus:theStatus
                                                    messageAsString:theString];
        
        [weakSelf.commandDelegate sendPluginResult:result
                                        callbackId:weakSelf.latestCommand.callbackId];
        
        weakSelf.hasPendingOperation = NO;
    };
    
    // Hide the picker view
    [self.viewController dismissViewControllerAnimated:YES completion:theRest];
}

@end
