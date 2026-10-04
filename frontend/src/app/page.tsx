"use client";

import { useEffect, useState } from "react";
import { fetchApi } from "../lib/api";

type HealthResponse = {
  status: string;
};

export default function Home() {
  const [status, setStatus] = useState<string>("Connecting...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkHealth() {
      try {
        const data = await fetchApi<HealthResponse>("/health");
        setStatus(data.status);
      } catch (err) {
        setStatus("Failed");
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    checkHealth();
  }, []);

  return (
    <main className="p-8 font-sans max-w-lg mx-auto mt-10">
      <h1 className="text-2xl font-bold mb-6">IRM Portal</h1>
      <div className="p-6 border border-gray-200 rounded-lg shadow-sm bg-white">
        <div className="mb-4 text-lg">
          <strong>Backend connection:</strong>{" "}
          <span className={status === "healthy" ? "text-green-600 font-semibold" : status === "Failed" ? "text-red-600 font-semibold" : "text-gray-600"}>
            {status === "healthy" ? "Connected" : status === "Failed" ? "Failed" : "Connecting..."}
          </span>
        </div>
        <div className="text-gray-700">
          <strong>Health status:</strong> {status}
        </div>
        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm border border-red-200 rounded">
            <strong>Error details:</strong> {error}
          </div>
        )}
      </div>
    </main>
  );
}
