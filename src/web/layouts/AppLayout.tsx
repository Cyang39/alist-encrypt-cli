import { useState } from "react";
import { Navigate, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/index.tsx";

function SidebarLink({
  to,
  icon,
  label,
  onClick,
}: {
  to: string;
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 text-sm rounded-lg transition-colors ${
          isActive
            ? "bg-blue-50 text-blue-600 font-medium"
            : "text-gray-600 hover:bg-gray-100"
        }`
      }
    >
      <span className="text-lg">{icon}</span>
      {label}
    </NavLink>
  );
}

export default function AppLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const token = localStorage.getItem("console_token");

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    localStorage.removeItem("console_token");
    navigate("/login");
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Mobile top bar */}
      <header className="md:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <h1 className="text-lg font-bold text-gray-800">alist-encrypt</h1>
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            {menuOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            )}
          </svg>
        </button>
      </header>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="md:hidden bg-white border-b border-gray-200 px-3 py-2 space-y-1 flex-shrink-0 shadow-sm">
          <SidebarLink
            to="/home"
            icon="🏠"
            label={t("sidebar.home")}
            onClick={closeMenu}
          />
          <SidebarLink
            to="/encrypt"
            icon="🔒"
            label={t("sidebar.encrypt")}
            onClick={closeMenu}
          />
          <SidebarLink
            to="/settings"
            icon="⚙️"
            label={t("sidebar.settings")}
            onClick={closeMenu}
          />
          <button
            type="button"
            onClick={() => {
              closeMenu();
              handleLogout();
            }}
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg w-full transition-colors"
          >
            <span className="text-lg">🚪</span>
            {t("sidebar.logout")}
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-60 bg-white border-r border-gray-200 flex-col flex-shrink-0 overflow-y-auto">
          <div className="px-4 py-5 border-b border-gray-200 flex-shrink-0">
            <h1 className="text-lg font-bold text-gray-800">alist-encrypt</h1>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            <SidebarLink to="/home" icon="🏠" label={t("sidebar.home")} />
            <SidebarLink to="/encrypt" icon="🔒" label={t("sidebar.encrypt")} />
            <SidebarLink
              to="/settings"
              icon="⚙️"
              label={t("sidebar.settings")}
            />
          </nav>
          <div className="px-3 py-4 border-t border-gray-200 flex-shrink-0">
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-lg w-full transition-colors"
            >
              <span className="text-lg">🚪</span>
              {t("sidebar.logout")}
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto min-h-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
