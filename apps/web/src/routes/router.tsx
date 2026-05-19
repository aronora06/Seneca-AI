import { createBrowserRouter, Navigate } from "react-router-dom";

import { LoginPage } from "../auth/LoginPage";
import { AppWorkspace } from "../app/AppWorkspace";
import { LegalPage } from "../components/Legal/LegalPage";
import { AboutPage } from "../pages/marketing/AboutPage";
import { HomePage } from "../pages/marketing/HomePage";
import { MarketingLayout } from "../pages/marketing/MarketingLayout";
import { PricingPage } from "../pages/marketing/PricingPage";
import { RedirectIfAuthed } from "./RedirectIfAuthed";
import { RequireAuth } from "./RequireAuth";
import { RootLayout } from "./RootLayout";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <MarketingLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: "about", element: <AboutPage /> },
          { path: "pricing", element: <PricingPage /> },
          { path: "privacy", element: <LegalPage kind="privacy" /> },
          { path: "terms", element: <LegalPage kind="terms" /> },
        ],
      },
      {
        path: "login",
        element: (
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        ),
      },
      {
        path: "app",
        element: (
          <RequireAuth>
            <AppWorkspace />
          </RequireAuth>
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
