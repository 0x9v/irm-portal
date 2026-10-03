import { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import Header from "@/components/Header";

export default function IrmLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header />
        <main className="flex-grow">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}
