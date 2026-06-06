import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";

function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async () => {
    setError("");
    try {
      const resp = await fetch("/@console/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await resp.json();
      if (data.success) {
        localStorage.setItem("token", data.token);
        navigate("/home");
      } else {
        setError(data.message || "Login failed");
      }
    } catch {
      setError("Network error");
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Login</h1>
      <input
        type="password"
        placeholder="Enter password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleLogin()}
        className="w-full px-4 py-2 border rounded-lg mb-4"
      />
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      <button
        type="button"
        onClick={handleLogin}
        className="w-full bg-blue-500 text-white py-2 rounded-lg hover:bg-blue-600"
      >
        Login
      </button>
    </div>
  );
}

function Home() {
  const handleLogout = () => {
    localStorage.removeItem("token");
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">Home</h1>
      <p className="text-gray-600">Welcome to alist-encrypt console</p>
      <Link
        to="/login"
        onClick={handleLogout}
        className="text-blue-500 hover:underline mt-4 block"
      >
        Logout
      </Link>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
