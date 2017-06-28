//
//  ClippingCamera.h
//  BusiCdAutoClip
//
//  Created by Manfred Wühr on 23.06.17.
//
//

#import <Cordova/CDVPlugin+Resources.h>

// Import the CustomCameraViewController class
#import "ClippingCameraViewController.h"

@interface ClippingCamera : CDVPlugin

// Cordova command method
-(void) openCamera:(CDVInvokedUrlCommand*)command;

// Create and override some properties and methods
-(void) returnCapturedImage:(NSString*)base64Image;
-(void) returnWithError:(NSString*)errorString;

@property (strong, nonatomic) ClippingCameraViewController* theCameraViewController;
@property (strong, nonatomic) CDVInvokedUrlCommand* latestCommand;
@property (readwrite, assign) BOOL hasPendingOperation;

@end
