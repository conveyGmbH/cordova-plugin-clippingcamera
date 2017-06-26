//
//  ClippingCameraViewController.m
//  BusiCdAutoClip
//
//  Created by Manfred Wühr on 23.06.17.
//
//

#import "ClippingCamera.h"
#import "ClippingCameraViewController.h"

@interface ClippingCameraViewController ()

@end

@implementation ClippingCameraViewController
{
    AVCaptureDevice *inputDevice;
    UIDeviceOrientation currentOrientation;
    std::vector<cv::Point2f> thePolygon;
    Mat theMatImage;
}

#warning brauchts das hier?
- (id)initWithNibName:(NSString *)nibNameOrNil bundle:(NSBundle *)nibBundleOrNil {
    self = [super initWithNibName:nibNameOrNil bundle:nibBundleOrNil];
    if (self) {
//        // Instantiate the UIImagePickerController instance
//        self.picker = [[UIImagePickerController alloc] init];
//        
//        // Configure the UIImagePickerController instance
//        self.picker.sourceType = UIImagePickerControllerSourceTypeCamera;
//        self.picker.cameraCaptureMode = UIImagePickerControllerCameraCaptureModePhoto;
//        self.picker.cameraDevice = UIImagePickerControllerCameraDeviceRear;
//        self.picker.showsCameraControls = NO;
//        
//        // Make us the delegate for the UIImagePickerController
//        self.picker.delegate = self;
//        
//        // Set the frames to be full screen
//        CGRect screenFrame = [[UIScreen mainScreen] bounds];
//        self.view.frame = screenFrame;
//        self.picker.view.frame = screenFrame;
//        
//        // Set this VC's view as the overlay view for the UIImagePickerController
//        self.picker.cameraOverlayView = self.view;
    }
    return self;
}

#warning oder das? oder beides?
- (void)viewDidLoad {
    [super viewDidLoad];
    // Do any additional setup after loading the view from its nib.
    
    [[UIDevice currentDevice] beginGeneratingDeviceOrientationNotifications];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(deviceOrientationDidChange:)
                                                 name:UIDeviceOrientationDidChangeNotification
                                               object:nil];
    
    self.videoCamera = [[CvVideoCamera alloc] initWithParentView:imageView];
    self.videoCamera.delegate = self;
    self.videoCamera.defaultAVCaptureDevicePosition = AVCaptureDevicePositionBack;
#warning wie wär's beim iPhone4? muß es überhaupt noch unterstützt werden?!
    if (UI_USER_INTERFACE_IDIOM() == UIUserInterfaceIdiomPad) {
        self.videoCamera.defaultAVCaptureSessionPreset = AVCaptureSessionPreset640x480;
    } else {
        self.videoCamera.defaultAVCaptureSessionPreset = AVCaptureSessionPreset1280x720;
    }
    self.videoCamera.defaultFPS = 30;
    self.videoCamera.grayscaleMode = NO;
    
    inputDevice = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
}

- (void)didReceiveMemoryWarning {
    [super didReceiveMemoryWarning];
    // Dispose of any resources that can be recreated.
}

- (void)dealloc
{
    [[UIDevice currentDevice] endGeneratingDeviceOrientationNotifications];
    [[NSNotificationCenter defaultCenter] removeObserver:self
                                                    name:UIDeviceOrientationDidChangeNotification
                                                  object:nil];
}

- (UIInterfaceOrientationMask)supportedInterfaceOrientations
{
    return UIInterfaceOrientationMaskAll;
}


#warning die Methode braucht's (so) im PlugIn nicht (den Kamera-Start und den Torch-Btn halt irgendwie)
- (void)startCamera {
#warning "Cancel"-Button sprachspezifisch
    switchTorchButton.hidden = !inputDevice.torchAvailable;
    [self.videoCamera start];
}


#pragma mark - UI Actions

- (IBAction)cancelFoto:(id)sender {
    [self.videoCamera stop];
#warning hier noch "Abbrechen"-Übergabe ans Cordova
}

- (IBAction)switchTorch:(id)sender {
    AVCaptureTorchMode tm = inputDevice.torchMode == AVCaptureTorchModeOff ? AVCaptureTorchModeOn : AVCaptureTorchModeOff;
    
    [inputDevice lockForConfiguration:nil];
    [inputDevice setTorchMode:tm];
    [inputDevice unlockForConfiguration];
    
    NSString *btnName = tm == AVCaptureTorchModeOn ? @"icons8FlashOff" : @"icons8FlashOn";
#warning PlugIn: Icon setzen per PlugIn-spezifischem pluginImageResource
    [switchTorchButton setImage:[UIImage imageNamed:btnName] forState:UIControlStateNormal];
}

- (IBAction)takeFoto:(id)sender {
    AudioServicesPlaySystemSound(1108); // takePhotoButton.caf from /System/Library/Audio/UISounds/
    
    [self.videoCamera stop];
    
    [self rectifyAndCut];
    UIImage *finalImage = MatToUIImage(theMatImage);
    
#warning hier fehlt noch die Option für die Bild-Qualität
    NSData *imgAsData = UIImageJPEGRepresentation(finalImage, 0);//[options.quality floatValue] / 100.0f);
    [self.plugin returnCapturedImage:[imgAsData base64EncodedStringWithOptions:0]];
}


#pragma mark - private methods

- (void)deviceOrientationDidChange:(NSNotification*)notification
{
    // ignoring specific - for us useless - orientations
    UIDeviceOrientation newOri = [[UIDevice currentDevice] orientation];
    if(newOri != UIDeviceOrientationFaceUp &&
       newOri != UIDeviceOrientationFaceDown &&
       newOri != UIDeviceOrientationUnknown &&
       newOri != currentOrientation)
    {
        currentOrientation = newOri;
        
        [self.videoCamera stop];
        self.videoCamera.defaultAVCaptureVideoOrientation = (AVCaptureVideoOrientation)currentOrientation;
        
        if (UI_USER_INTERFACE_IDIOM() == UIUserInterfaceIdiomPhone) {
            [self positionTheButtons];
        }
        
        [self performSelector:@selector(reStartCamera) withObject:Nil afterDelay:0.01];
    }
}

- (void)reStartCamera
{
    [self.videoCamera start];
}

- (void)positionTheButtons
{
    CGSize  theSize   = self.view.bounds.size;
    CGFloat theWidth  = theSize.width
    ,       theHeight = theSize.height
    ,       margin    = 16
    ,       bigBtn    = 66
    ,       smallBtn  = 25
    ,       txtBtnW   = 100
    ,       txtBtnH   = 30;
    
    if (UIDeviceOrientationIsPortrait(currentOrientation)) {
        [takePhotoButton setFrame:CGRectMake(theWidth/2 - bigBtn/2, theHeight - margin - bigBtn, bigBtn, bigBtn)];
        [switchTorchButton setFrame:CGRectMake(theWidth - margin - smallBtn, theHeight - margin  - bigBtn/2 - smallBtn/2, smallBtn, smallBtn)];
        [cancelButton setFrame:CGRectMake(margin, theHeight - margin - bigBtn/2 - txtBtnH/2, txtBtnW, txtBtnH)];
        [cancelButton setContentHorizontalAlignment:UIControlContentHorizontalAlignmentLeft];
    } else {
        [takePhotoButton setFrame:CGRectMake(theWidth - margin - bigBtn, theHeight/2 - bigBtn/2, bigBtn, bigBtn)];
        [switchTorchButton setFrame:CGRectMake(theWidth - margin - bigBtn/2 - smallBtn/2, margin, smallBtn, smallBtn)];
        [cancelButton setFrame:CGRectMake(theWidth - margin - txtBtnW, theHeight - margin - txtBtnH, txtBtnW, txtBtnH)];
        [cancelButton setContentHorizontalAlignment:UIControlContentHorizontalAlignmentRight];
    }
}


#pragma mark - Protocol CvVideoCameraDelegate

#ifdef __cplusplus

- (void)processImage:(Mat&)image
{
    Mat imageWork;
    int imgWidth  = image.size().width
    , imgHeight = image.size().height;
    
    // keep a *copy* of it for later use (right in the then needed format)
    cvtColor(image, theMatImage, COLOR_BGR2RGB);
    
    // convert it
    cvtColor(image, imageWork, COLOR_BGR2GRAY);
    GaussianBlur(imageWork, imageWork, cv::Size(5, 5), 0);
    Canny(imageWork, imageWork, 80, 200);
    
    // extract the contours
    std::vector<std::vector<cv::Point> > contours;
    findContours(imageWork, contours, RETR_LIST, CHAIN_APPROX_SIMPLE);
    
    double minArea = (imgWidth * imgHeight) / 8
    , maxArea = 0;
    int    idx_max = -1;
    size_t count   = contours.size();
    for (int k = 0; k < count; k++) {
        std::vector<cv::Point> hull;
        convexHull(contours[k], hull);
        double area = contourArea(hull);
        if (area > maxArea && area > minArea) {
            maxArea = area;
            idx_max = k;
        }
    }
    std::vector<cv::Point2f> approx;
    if (idx_max >= 0 && idx_max < count) {
        double peri = arcLength(contours[idx_max], true);
        approxPolyDP(contours[idx_max], approx, 0.02 * peri, true);
        if (approx.size() == 4) {
            thePolygon = approx;
        } else {
            approx = thePolygon;
            thePolygon.clear();
        }
    } else {
        approx = thePolygon;
        thePolygon.clear();
    }
    
    if (approx.size() > 0) {
        // draw approx only if it has 4 corners
        std::vector<cv::Point> approx2;
        for (size_t k = 0; k < approx.size(); k++) {
            cv::Point pt2(approx[k].x, approx[k].y);
            approx2.insert(approx2.begin(), pt2);
        }
        std::vector<std::vector<cv::Point> > outContours2;
        outContours2.insert(outContours2.begin(), approx2);
        
        drawContours(image, outContours2, -1, Scalar(0, 255, 0), 2);
    }
}

- (void)rectifyAndCut
{
    size_t sz = thePolygon.size();
    if (sz == 4) {
        // sort the polygon's corners
        cv::Point2f center(0,0);
        for(int i = 0; i < sz; i++) {
            center += thePolygon[i];
        }
        center *= (1. / sz);
        std::vector<cv::Point2f> top, bot;
        for (int i = 0; i < sz; i++) {
            if ((thePolygon[i].y < center.y && top.size() < 2) || bot.size() == 2)
                top.push_back(thePolygon[i]);
            else
                bot.push_back(thePolygon[i]);
        }
        sort(top.begin(), top.end(), comparator);
        sort(bot.begin(), bot.end(), comparator);
        thePolygon.clear();
        thePolygon.push_back(top[0]);
        thePolygon.push_back(top[1]);
        thePolygon.push_back(bot[1]);
        thePolygon.push_back(bot[0]);
        
        // find dimensions for the destination image;
        // don't do it via boundingRect(thePolygon),
        // which maybe results in distortions,
        // that are less severe when taking the averages of opposite sides
        std::vector<cv::Point2f> side1, side2, side3, side4;
        side1.push_back(top[0]);
        side1.push_back(top[1]);
        side2.push_back(top[1]);
        side2.push_back(bot[1]);
        side3.push_back(bot[1]);
        side3.push_back(bot[0]);
        side4.push_back(bot[0]);
        side4.push_back(top[0]);
        double len1 = arcLength(side1, false)
        ,      len2 = arcLength(side2, false)
        ,      len3 = arcLength(side3, false)
        ,      len4 = arcLength(side4, false);
        int wdth = round((len1 + len3) / 2)
        ,   hght = round((len2 + len4) / 2);
        
        // define the destination image
        Mat result = Mat::zeros(hght, wdth, theMatImage.type());
        // corners of the destination image
        std::vector<cv::Point2f> resultPolygon;
        resultPolygon.push_back(cv::Point2f(0, 0));
        resultPolygon.push_back(cv::Point2f(result.cols, 0));
        resultPolygon.push_back(cv::Point2f(result.cols, result.rows));
        resultPolygon.push_back(cv::Point2f(0, result.rows));
        
        // get transformation matrix
        Mat transmtx = getPerspectiveTransform(thePolygon, resultPolygon);
        // apply perspective transformation
        warpPerspective(theMatImage, result, transmtx, result.size());
        
        theMatImage = result;
    }
}

bool comparator(Point2f a,Point2f b)
{
    return a.x < b.x;
}

#endif

@end