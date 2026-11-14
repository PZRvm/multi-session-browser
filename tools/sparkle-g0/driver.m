// G0 生命周期验证：独立 Cocoa host，只测官方框架，不接生产更新装配。
#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>

static void logEvent(NSString *name, NSDictionary *details) {
  NSMutableDictionary *event = [details mutableCopy];
  event[@"event"] = name;
  event[@"at"] = @((long long)(NSDate.date.timeIntervalSince1970 * 1000));
  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:NULL];
  puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
  fflush(stdout);
}

@interface Driver : NSObject <NSApplicationDelegate, SPUUserDriver, SPUUpdaterDelegate>
@property(nonatomic, strong) SPUUpdater *updater;
@property(nonatomic) BOOL quitAfterCancellation;
@property(nonatomic) BOOL refuseTermination;
@end
@implementation Driver
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  if ([NSBundle.mainBundle.infoDictionary[@"CFBundleVersion"] isEqual:@"90.0.2"]) {
    NSString *marker = [[NSBundle.mainBundle.bundlePath stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"installed-marker"];
    [@"90.0.2" writeToFile:marker atomically:YES encoding:NSUTF8StringEncoding error:NULL];
    logEvent(@"launched-new-version", @{}); exit(0);
  }
  self.updater = [[SPUUpdater alloc] initWithHostBundle:NSBundle.mainBundle
    applicationBundle:NSBundle.mainBundle userDriver:self delegate:self];
  NSError *error = nil;
  if (![self.updater startUpdater:&error]) {
    logEvent(@"init-error", @{@"message":error.description}); exit(2);
  }
  [self.updater checkForUpdates];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    logEvent(@"timeout", @{}); exit(3);
  });
}
- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply {
  logEvent(@"unexpected-permission", @{}); exit(4);
}
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation { logEvent(@"checking", @{}); }
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply {
  logEvent(@"found", @{@"version":item.versionString, @"stage":@(state.stage)});
  // 脚本模拟用户在 500ms 后明确点下载；检查阶段不回复 Install。
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC/2), dispatch_get_main_queue(), ^{
    logEvent(@"download-permission", @{}); reply(SPUUserUpdateChoiceInstall);
  });
}
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)data {
  NSString *body = [[NSString alloc] initWithData:data.data encoding:NSUTF8StringEncoding];
  logEvent(@"notes", @{@"body":body ?: @""});
}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error { logEvent(@"notes-error", @{}); }
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  logEvent(@"not-found", @{}); acknowledgement(); exit(5);
}
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  logEvent(@"error", @{@"message":error.description}); acknowledgement(); exit(6);
}
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation { logEvent(@"download", @{}); }
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length {}
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {}
- (void)showDownloadDidStartExtractingUpdate { logEvent(@"extracting", @{}); }
- (void)showExtractionReceivedProgress:(double)progress {}
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
  logEvent(@"ready", @{});
  NSString *mode = NSProcessInfo.processInfo.environment[@"SPARKLE_G0_MODE"];
  if ([mode isEqual:@"install-cancel"]) {
    self.quitAfterCancellation = YES;
    self.refuseTermination = YES;
    reply(SPUUserUpdateChoiceInstall);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      self.refuseTermination = NO;
      logEvent(@"cancel-after-install-permission", @{});
      reply(SPUUserUpdateChoiceSkip);
    });
    return;
  }
  if ([mode isEqual:@"install"]) {
    logEvent(@"later-in-process", @{});
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      logEvent(@"save-success", @{});
      reply(SPUUserUpdateChoiceInstall);
    });
    return;
  }
  if ([mode isEqual:@"save-failure"]) logEvent(@"save-rejected", @{});
  // Skip 是官方公开取消安装接口，不能用 Dismiss 冒充“不随退出安装”。
  self.quitAfterCancellation = YES;
  reply(SPUUserUpdateChoiceSkip);
  logEvent(@"skip", @{});
}
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
  return self.refuseTermination ? NSTerminateCancel : NSTerminateNow;
}
- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
  if (self.quitAfterCancellation) {
    logEvent(@"cancel-cycle-finished", @{});
    [NSApp terminate:nil];
  }
}
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)terminated retryTerminatingApplication:(void (^)(void))retry {
  logEvent(@"installing", @{@"terminated":@(terminated)});
}
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement {
  logEvent(@"installed", @{}); acknowledgement();
}
- (void)dismissUpdateInstallation { logEvent(@"dismissed", @{}); }
@end

#ifdef ELECTRON_G0
#include <node_api.h>
static Driver *electronDriver;
static napi_value Start(napi_env env, napi_callback_info info) {
  electronDriver = [Driver new];
  [electronDriver applicationDidFinishLaunching:nil];
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}
NAPI_MODULE_INIT() {
  napi_value function;
  napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, NULL, &function);
  napi_set_named_property(env, exports, "start", function);
  return exports;
}
#else
int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    Driver *driver = [Driver new];
    [NSApp setDelegate:driver];
    [NSApp run];
  }
  return 0;
}
#endif
