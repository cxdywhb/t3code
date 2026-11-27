import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { I18nProvider } from "./i18n/I18nProvider";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";
import { isGlobalTerminalWindow } from "./components/terminal/globalTerminalStore";
import { useTheme } from "./hooks/useTheme";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  // Auxiliary windows also need the storage and system appearance listeners for their whole lifetime.
  useTheme();
  return (
    <I18nProvider>
      <AppAtomRegistryProvider>
        <RouterProvider router={router} />
        {isGlobalTerminalWindow() ? null : (
          <>
            <ElectronBrowserHost />
            <QuitHoldOverlay />
          </>
        )}
      </AppAtomRegistryProvider>
    </I18nProvider>
  );
}
