import { createRoot } from "react-dom/client";

function App() {
  return (
    <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
      <h1 className="text-2xl font-bold text-gray-800">Hello Tailwind</h1>
      <p className="text-gray-600 mt-2">This is a single HTML file.</p>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
