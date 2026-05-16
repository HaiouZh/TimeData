import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { executeAndroidBackAction, resolveAndroidBackAction } from "../lib/androidBackNavigation.ts";

export default function AndroidBackButtonHandler() {
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = useRef(location);
  const navigateRef = useRef(navigate);
  locationRef.current = location;
  navigateRef.current = navigate;

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;

    let disposed = false;
    const listener = CapacitorApp.addListener("backButton", () => {
      const current = locationRef.current;
      executeAndroidBackAction(
        resolveAndroidBackAction(current.pathname),
        current.key,
        navigateRef.current,
        () => { void CapacitorApp.exitApp(); },
      );
    });

    return () => {
      disposed = true;
      void listener.then((handle) => {
        if (disposed) handle.remove();
      });
    };
  }, []);

  return null;
}
