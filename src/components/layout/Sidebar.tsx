"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  MapPin,
  Send,
  Users,
  Columns3,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  MessageCircle,
  User as UserIcon,
} from "lucide-react";
import { useState } from "react";

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: MapPin, label: "Extrator Maps", href: "/extractor" },
  { icon: Send, label: "Disparo", href: "/disparo" },
  { icon: MessageCircle, label: "Inbox", href: "/inbox" },
  { icon: Columns3, label: "CRM Kanban", href: "/crm" },
  { icon: Users, label: "Gerenciar Contas", href: "/contas" },
  { icon: BarChart3, label: "Relatórios", href: "/relatorios" },
  { icon: Settings, label: "Configurações", href: "/configuracoes" },
];

type SidebarProps = {
  userName?: string;
  userEmail?: string;
};

export function Sidebar({ userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleLogout = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen transition-all duration-300 ease-in-out bg-card border-r border-border",
        isOpen ? "w-64" : "w-20"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-border">
          {isOpen && (
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
              MapDisparo
            </span>
          )}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 rounded-md hover:bg-accent transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {menuItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  !isOpen && "justify-center px-0"
                )}
              >
                <item.icon className={cn("h-5 w-5", isOpen && "mr-3")} />
                {isOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User block + logout */}
        <div className="p-4 border-t border-border space-y-2">
          {(userName || userEmail) && (
            <div
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 bg-accent/30",
                !isOpen && "justify-center px-0"
              )}
              title={userEmail || userName}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <UserIcon size={16} />
              </div>
              {isOpen && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" data-testid="sidebar-user-name">
                    {userName}
                  </p>
                  {userEmail && userEmail !== userName && (
                    <p className="truncate text-xs text-muted-foreground" data-testid="sidebar-user-email">
                      {userEmail}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleLogout}
            disabled={isSigningOut}
            className={cn(
              "flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50",
              !isOpen && "justify-center px-0"
            )}
            data-testid="sidebar-logout"
          >
            <LogOut className={cn("h-5 w-5", isOpen && "mr-3")} />
            {isOpen && <span>{isSigningOut ? "Saindo…" : "Sair"}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
