// 主进程专用 Node-API 桥。下载、验签、替换均由官方 Sparkle 完成。
#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

static napi_threadsafe_function eventSink;
static NSUInteger generation;
static NSString *version;
static BOOL cancelling;

static BOOL signatureError(NSError *error, NSUInteger depth) {
  if (!error || depth > 8) return NO;
  if ([error.domain isEqual:SUSparkleErrorDomain] &&
      (error.code == SUSignatureError || error.code == SUValidationError)) return YES;
  return signatureError(error.userInfo[NSUnderlyingErrorKey], depth + 1);
}

static void emit(NSString *type, NSDictionary *fields) {
  if (!eventSink) return;
  NSMutableDictionary *value = [fields mutableCopy];
  value[@"type"] = type;
  value[@"generation"] = @(generation);
  if (version) value[@"version"] = version;
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
  if (!data) return;
  char *json = calloc(data.length + 1, 1);
  memcpy(json, data.bytes, data.length);
  if (napi_call_threadsafe_function(eventSink, json, napi_tsfn_nonblocking) != napi_ok) free(json);
}
static void deliver(napi_env env, napi_value callback, void *context, void *data) {
  if (env && callback) {
    napi_value value, receiver;
    napi_create_string_utf8(env, data, NAPI_AUTO_LENGTH, &value);
    napi_get_undefined(env, &receiver);
    napi_call_function(env, receiver, callback, 1, &value, NULL);
  }
  free(data);
}

@interface UpdateDriver : NSObject <SPUUserDriver, SPUUpdaterDelegate>
@property(nonatomic, strong) SPUUpdater *updater;
@property(nonatomic, copy) void (^foundReply)(SPUUserUpdateChoice);
@property(nonatomic, copy) void (^readyReply)(SPUUserUpdateChoice);
@property(nonatomic, copy) void (^cancelOperation)(void);
@property(nonatomic, strong) SUAppcastItem *item;
@property(nonatomic) BOOL availableSent;
@property(nonatomic) BOOL reportedError;
@property(nonatomic) uint64_t received;
@property(nonatomic) uint64_t total;
@end

@implementation UpdateDriver
- (BOOL)updater:(SPUUpdater *)updater shouldDownloadReleaseNotesForUpdate:(SUAppcastItem *)item {
  NSURL *url = item.releaseNotesURL;
  NSURL *feed = [NSURL URLWithString:NSBundle.mainBundle.infoDictionary[@"SUFeedURL"]];
  BOOL test = [NSBundle.mainBundle.infoDictionary[@"MSBSparkleTestBuild"] boolValue];
  BOOL allowed = [url.host isEqual:feed.host] && ([url.scheme isEqual:@"https"] || (test && [url.scheme isEqual:@"http"] && [url.host isEqual:@"127.0.0.1"]));
  if (!allowed) [self sendAvailable:@""];
  return allowed;
}
- (void)sendAvailable:(NSString *)notes {
  if (self.availableSent || cancelling || !self.item) return;
  self.availableSent = YES;
  emit(@"available", @{@"notes":notes ?: @"", @"date":self.item.date ? @([self.item.date timeIntervalSince1970] * 1000) : @0});
}
- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request reply:(void (^)(SUUpdatePermissionResponse *))reply {
  self.reportedError = YES;
  emit(@"error", @{@"message":@"更新策略配置错误：不应出现原生权限询问", @"signature":@NO});
  reply([[SUUpdatePermissionResponse alloc] initWithAutomaticUpdateChecks:NO sendSystemProfile:NO]);
}
- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation { self.cancelOperation = cancellation; }
- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item state:(SPUUserUpdateState *)state reply:(void (^)(SPUUserUpdateChoice))reply {
  if (state.stage != SPUUserUpdateStageNotDownloaded) {
    // 非本进程已授权下载的遗留 installer 不得自动恢复或安装。
    reply(SPUUserUpdateChoiceSkip);
    self.reportedError = YES;
    emit(@"error", @{@"message":@"发现旧的更新安装状态，已取消，请重新检查", @"signature":@NO});
    return;
  }
  version = item.versionString;
  self.item = item;
  self.foundReply = reply;
  self.cancelOperation = nil;
  if (!item.releaseNotesURL) [self sendAvailable:item.itemDescription];
  NSUInteger current = generation;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5*NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (generation == current) [self sendAvailable:@""];
  });
}
- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)data {
  NSString *notes = data.data.length <= 65536 ? [[NSString alloc] initWithData:data.data encoding:NSUTF8StringEncoding] : @"";
  [self sendAvailable:notes];
}
- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error { [self sendAvailable:@""]; }
- (void)showUpdateNotFoundWithError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  self.reportedError = YES;
  emit(@"latest", @{}); acknowledgement();
}
- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
  self.reportedError = YES;
  emit(@"error", @{@"message":error.description, @"signature":@(signatureError(error, 0))});
  acknowledgement();
}
- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {
  self.cancelOperation = cancellation; self.received = 0; self.total = 0;
}
- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)length { self.total = length; }
- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {
  self.received += length;
  emit(@"progress", @{@"transferred":@(self.received), @"total":@(self.total), @"percent":@(self.total ? 100.0*self.received/self.total : 0)});
}
- (void)showDownloadDidStartExtractingUpdate { self.cancelOperation = nil; }
- (void)showExtractionReceivedProgress:(double)progress { emit(@"heartbeat", @{}); }
- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
  self.readyReply = reply;
  emit(@"ready", @{});
  if (cancelling) reply(SPUUserUpdateChoiceSkip);
}
- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)terminated retryTerminatingApplication:(void (^)(void))retry {}
- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement { acknowledgement(); }
- (void)dismissUpdateInstallation {}
- (void)updater:(SPUUpdater *)updater didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)check error:(NSError *)error {
  self.foundReply = nil; self.readyReply = nil; self.cancelOperation = nil; self.item = nil;
  if (cancelling) { cancelling = NO; emit(@"cancelled", @{}); }
  else if (error && !self.reportedError) emit(@"error", @{@"message":error.description, @"signature":@(signatureError(error, 0))});
  else emit(@"cycle-finished", @{});
}
@end

static UpdateDriver *driver;
static NSString *argument(napi_env env, napi_value value) {
  size_t length;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &length) != napi_ok || length > 128) return nil;
  char buffer[129];
  napi_get_value_string_utf8(env, value, buffer, sizeof(buffer), &length);
  return [[NSString alloc] initWithBytes:buffer length:length encoding:NSUTF8StringEncoding];
}
static void cleanup(void *unused) {
  if (eventSink) { napi_release_threadsafe_function(eventSink, napi_tsfn_abort); eventSink = NULL; }
}
static napi_value initialize(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value values[1], result, name;
  napi_get_cb_info(env, info, &count, values, NULL, NULL);
  if (count != 1 || driver || !NSThread.isMainThread) { napi_throw_error(env, NULL, "更新桥接初始化条件错误"); return NULL; }
  napi_create_string_utf8(env, "Sparkle 更新事件", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, values[0], NULL, name, 0, 1, NULL, NULL, NULL, deliver, &eventSink) != napi_ok) { napi_throw_error(env, NULL, "更新事件回调错误"); return NULL; }
  napi_unref_threadsafe_function(env, eventSink);
  napi_add_env_cleanup_hook(env, cleanup, NULL);
  driver = [UpdateDriver new];
  driver.updater = [[SPUUpdater alloc] initWithHostBundle:NSBundle.mainBundle applicationBundle:NSBundle.mainBundle userDriver:driver delegate:driver];
  driver.updater.automaticallyChecksForUpdates = NO;
  driver.updater.automaticallyDownloadsUpdates = NO;
  NSError *error;
  if (![driver.updater startUpdater:&error]) { napi_throw_error(env, NULL, error.description.UTF8String); return NULL; }
  napi_get_undefined(env, &result); return result;
}
static napi_value command(napi_env env, napi_callback_info info) {
  size_t count = 2; napi_value values[2], result;
  napi_get_cb_info(env, info, &count, values, NULL, NULL);
  if (!driver || !count || !NSThread.isMainThread) { napi_throw_error(env, NULL, "更新桥接尚未初始化"); return NULL; }
  NSString *action = argument(env, values[0]);
  NSString *expected = count > 1 ? argument(env, values[1]) : nil;
  if ([action isEqual:@"check"]) {
    if (!driver.updater.canCheckForUpdates) { napi_throw_error(env, NULL, "更新周期尚未完成"); return NULL; }
    generation++; version = nil; driver.availableSent = NO; driver.reportedError = NO;
    [driver.updater checkForUpdates];
  } else if ([action isEqual:@"download"] && driver.foundReply && [expected isEqual:version] && !cancelling) {
    void (^reply)(SPUUserUpdateChoice) = driver.foundReply;
    driver.foundReply = nil; reply(SPUUserUpdateChoiceInstall);
  } else if ([action isEqual:@"install"] && driver.readyReply && [expected isEqual:version] && !cancelling) {
    driver.readyReply(SPUUserUpdateChoiceInstall);
  } else if ([action isEqual:@"cancel"]) {
    cancelling = YES;
    if (driver.readyReply) driver.readyReply(SPUUserUpdateChoiceSkip);
    else if (driver.cancelOperation) driver.cancelOperation();
    else if (driver.foundReply) driver.foundReply(SPUUserUpdateChoiceDismiss);
    else if (!driver.updater.sessionInProgress) { cancelling = NO; emit(@"cancelled", @{}); }
    // 解包期间暂不回退出许可，等待 ready 再提交 Skip。
  } else { napi_throw_error(env, NULL, "更新阶段或目标版本不符"); return NULL; }
  napi_get_undefined(env, &result); return result;
}
NAPI_MODULE_INIT() {
  napi_value initFunction, commandFunction;
  napi_create_function(env, "initialize", NAPI_AUTO_LENGTH, initialize, NULL, &initFunction);
  napi_create_function(env, "command", NAPI_AUTO_LENGTH, command, NULL, &commandFunction);
  napi_set_named_property(env, exports, "initialize", initFunction);
  napi_set_named_property(env, exports, "command", commandFunction);
  return exports;
}
