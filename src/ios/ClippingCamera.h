//
//  ClippingCamera.h
//  BusiCdAutoClip
//
//  Created by Manfred Wühr on 23.06.17.
//
//

#import <Cordova/CDV.h>

// Import the CustomCameraViewController class
#import "ClippingCameraViewController.h"

@interface ClippingCamera : CDVPlugin

// Cordova command method
-(void) openCamera:(CDVInvokedUrlCommand*)command;

// Create and override some properties and methods
-(void) returnCapturedImage:(NSString*)base64Image;

@property (strong, nonatomic) ClippingCameraViewController* theCameraViewController;
@property (strong, nonatomic) CDVInvokedUrlCommand* latestCommand;
@property (readwrite, assign) BOOL hasPendingOperation;

@end
