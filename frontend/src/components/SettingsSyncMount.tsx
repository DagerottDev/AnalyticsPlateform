"use client";

import { useEffect, useRef } from "react";
import { formatApiError } from "@/lib/apiError";
import { getUserPreferences, saveUserPreferences } from "@/lib/userPreferences";
import { currentUserPreferences, useSettingsStore } from "@/stores/settingsStore";
import { useAuthStore } from "@/stores/authStore";
import { useTickerStore } from "@/stores/tickerStore";
import { loadGreekWorkspaceLayout } from "@/lib/greekWorkspaceLayout";

/** Keeps harmless UI preferences in sync without delaying application startup. */
export function SettingsSyncMount() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const owner = useAuthStore((state) => state.user?.client_id ?? null);
  const revision = useSettingsStore((state) => state.revision);
  const dirty = useSettingsStore((state) => state.dirty);
  const hydratedOwner = useSettingsStore((state) => state.hydratedOwner);
  const watchlist = useSettingsStore((state) => state.general.watchlist);
  const initialOwnerRef = useRef<string | null>(null);

  useEffect(() => {
    useTickerStore.getState().setTickersFromPreferences(watchlist);
  }, [watchlist]);

  useEffect(() => {
    if (!isAuthenticated || !owner) {
      initialOwnerRef.current = null;
      return;
    }
    if (initialOwnerRef.current === owner) return;
    initialOwnerRef.current = owner;
    let cancelled = false;

    const hydrate = async () => {
      const store = useSettingsStore.getState();
      const isLegacyLocalProfile = store.profileOwner === null;
      store.prepareForOwner(owner);
      useSettingsStore.getState().markSyncLoading();
      try {
        const response = await getUserPreferences();
        if (cancelled) return;
        if (response.persisted) {
          useSettingsStore.getState().applyServerPreferences(response, owner, true);
          return;
        }

        if (isLegacyLocalProfile) {
          const legacyWatchlist = useTickerStore.getState().tickers;
          const legacyGreekLayout = loadGreekWorkspaceLayout();
          useSettingsStore.getState().updatePreferences((current) => ({
            ...current,
            general: { ...current.general, watchlist: legacyWatchlist },
            greekWorkspace: legacyGreekLayout ? {
              ...current.greekWorkspace,
              visibleGreeks: legacyGreekLayout.visibleGreeks,
              panels: legacyGreekLayout.panels,
              educationOpen: legacyGreekLayout.educationOpen,
            } : current.greekWorkspace,
          }));
        }
        const profile = currentUserPreferences();
        const saved = await saveUserPreferences(profile);
        if (!cancelled) useSettingsStore.getState().markSynced(saved, owner, useSettingsStore.getState().revision);
      } catch (error) {
        if (!cancelled) useSettingsStore.getState().markSyncError(formatApiError(error) || "Preferences are saved locally until the server reconnects.");
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [isAuthenticated, owner]);

  useEffect(() => {
    if (!isAuthenticated || !owner || !dirty || hydratedOwner !== owner) return;
    const revisionAtSchedule = revision;
    const timer = window.setTimeout(async () => {
      const store = useSettingsStore.getState();
      if (!store.dirty || store.hydratedOwner !== owner) return;
      store.markSyncSaving();
      try {
        const saved = await saveUserPreferences(currentUserPreferences());
        useSettingsStore.getState().markSynced(saved, owner, revisionAtSchedule);
      } catch (error) {
        useSettingsStore.getState().markSyncError(formatApiError(error) || "Preferences are saved locally until the server reconnects.");
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dirty, hydratedOwner, isAuthenticated, owner, revision]);

  return null;
}
