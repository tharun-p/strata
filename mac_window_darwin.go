//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit -framework QuartzCore
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

static NSWindow *strataMainWindow(void) {
	NSWindow *key = NSApp.keyWindow;
	if (key != nil && key.contentView != nil) {
		return key;
	}
	for (NSWindow *window in NSApp.windows) {
		if (window.contentView != nil && window.isVisible) {
			return window;
		}
	}
	return NSApp.windows.firstObject;
}

// Clip only the content view. Walking the full superview chain is an AppKit
// anti-pattern — it breaks shadows, zoom animation, and standard window chrome.
void StrataApplyRoundedWindow(double radius) {
	dispatch_async(dispatch_get_main_queue(), ^{
		NSWindow *window = strataMainWindow();
		if (window == nil || window.contentView == nil) {
			return;
		}

		window.opaque = NO;
		window.backgroundColor = NSColor.clearColor;
		window.hasShadow = YES;

		NSView *content = window.contentView;
		content.wantsLayer = YES;
		content.layer.cornerRadius = (CGFloat)radius;
		content.layer.masksToBounds = YES;
		if (@available(macOS 11.0, *)) {
			content.layer.cornerCurve = kCACornerCurveContinuous;
		}
		[window invalidateShadow];
	});
}

// Use AppKit's native zoom — same path as a titled window's green button /
// title-bar double-click. Do not reimplement with setFrame:animate:.
void StrataToggleZoomWindow(void) {
	dispatch_async(dispatch_get_main_queue(), ^{
		NSWindow *window = strataMainWindow();
		if (window == nil) {
			return;
		}
		[window zoom:nil];
	});
}

bool StrataWindowIsZoomed(void) {
	__block bool zoomed = false;
	if ([NSThread isMainThread]) {
		NSWindow *window = strataMainWindow();
		zoomed = window != nil && window.isZoomed;
		return zoomed;
	}
	dispatch_sync(dispatch_get_main_queue(), ^{
		NSWindow *window = strataMainWindow();
		zoomed = window != nil && window.isZoomed;
	});
	return zoomed;
}
*/
import "C"

func applyMacRoundedWindow(radius float64) {
	C.StrataApplyRoundedWindow(C.double(radius))
}

func toggleMacZoomWindow() {
	C.StrataToggleZoomWindow()
}

func macWindowIsZoomed() bool {
	return bool(C.StrataWindowIsZoomed())
}
