import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  RouterProvider,
} from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { LoginPage } from "../auth/LoginPage";
import { AppWorkspace } from "../app/AppWorkspace";
import { RequireAuth } from "./RequireAuth";
import { RedirectIfAuthed } from "./RedirectIfAuthed";
import { HashRedirect } from "./HashRedirect";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
  bypass: false,
}));

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    user: authState.user,
    loading: authState.loading,
    bypass: authState.bypass,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock("../lib/devBypass", () => ({
  devBypassAuth: false,
}));

vi.mock("../app/AppWorkspace", () => ({
  AppWorkspace: () => <div data-testid="app-workspace">App</div>,
}));

let container: HTMLDivElement;
let root: Root;

function renderRouter(initialEntries: string[]) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <HashRedirect />
            <RequireAuth>
              <AppWorkspace />
            </RequireAuth>
          </>
        ),
        path: "/app",
      },
      {
        path: "/login",
        element: (
          <RedirectIfAuthed>
            <LoginPage />
          </RedirectIfAuthed>
        ),
      },
    ],
    { initialEntries },
  );
  act(() => {
    root.render(<RouterProvider router={router} />);
  });
  return router;
}

beforeEach(() => {
  authState.user = null;
  authState.loading = false;
  authState.bypass = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("route guards", () => {
  it("redirects unauthenticated users from /app to /login", async () => {
    renderRouter(["/app"]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-testid="app-workspace"]')).toBeNull();
    expect(container.textContent).toContain("Sign in");
  });

  it("redirects authenticated users from /login to /app", async () => {
    authState.user = { id: "u1" };
    renderRouter(["/login"]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container.querySelector('[data-testid="app-workspace"]')).not.toBeNull();
  });
});

describe("HashRedirect", () => {
  it("migrates #privacy to /privacy", async () => {
    window.location.hash = "#privacy";
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <>
              <HashRedirect />
              <div>home</div>
            </>
          ),
        },
        { path: "/privacy", element: <div data-testid="privacy">Privacy</div> },
      ],
      { initialEntries: ["/"] },
    );
    act(() => {
      root.render(<RouterProvider router={router} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(router.state.location.pathname).toBe("/privacy");
    window.location.hash = "";
  });
});
