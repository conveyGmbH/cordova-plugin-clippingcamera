//
//  ClippingCameraViewController.h
//  BusiCdAutoClip
//
//  Created by Manfred Wühr on 23.06.17.
//
//

#import <opencv2/videoio/cap_ios.h>
#import <opencv2/imgcodecs/ios.h>
#import <AudioToolbox/AudioToolbox.h>

using namespace cv;

// We can't import the ClippingCamera class because it would make a circular reference,
// so "fake" the existence of the class like this:
@class ClippingCamera;

@interface ClippingCameraViewController : UIViewController<CvVideoCameraDelegate>
{
    IBOutlet UIImageView *imageView;
    IBOutlet UIButton *takePhotoButton;
    IBOutlet UIButton *switchTorchButton;
    IBOutlet UIButton *cancelButton;
}

@property (strong) NSNumber* pictureQuality;
@property (assign) BOOL convertToGrayscale;
@property (assign) BOOL dontClip;

@property (strong, nonatomic) ClippingCamera* plugin;
@property (nonatomic, retain) CvVideoCamera* videoCamera;

@end
