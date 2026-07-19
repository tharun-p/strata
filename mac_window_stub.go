//go:build !darwin

package main

func applyMacRoundedWindow(radius float64) {}

func toggleMacZoomWindow() {}

func macWindowIsZoomed() bool { return false }
