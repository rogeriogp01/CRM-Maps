import { 
  Users, 
  Send, 
  BarChart3, 
  Smartphone,
  TrendingUp,
  CheckCircle2,
  AlertCircle
} from "lucide-react";

const stats = [
  {
    label: "Leads Totais",
    value: "1,284",
    icon: Users,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    label: "Enviados Hoje",
    value: "450",
    icon: Send,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    label: "Taxa de Resposta",
    value: "12.5%",
    icon: BarChart3,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
  },
  {
    label: "Contas Conectadas",
    value: "3/5",
    icon: Smartphone,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Bem-vindo ao MapDisparo CRM. Aqui está o resumo das suas atividades.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-border bg-card p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </p>
                <h3 className="text-2xl font-bold mt-1">{stat.value}</h3>
              </div>
              <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </div>
            <div className="mt-4 flex items-center text-xs text-muted-foreground">
              <TrendingUp className="mr-1 h-3 w-3 text-green-500" />
              <span className="text-green-500 font-medium">+4.5%</span>
              <span className="ml-1">desde ontem</span>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Activity & Charts Placeholder */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="font-semibold mb-4">Campanhas Recentes</h3>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-accent/50 border border-border">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded bg-primary/20">
                    <Send className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Campanha #{i} - Academias BH</p>
                    <p className="text-xs text-muted-foreground">20/04/2026 às 14:30</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                   <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">Concluído</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h3 className="font-semibold mb-4">Status do Sistema</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">WhatsApp API (Baileys)</span>
              </div>
              <span className="text-xs text-green-500 font-medium">Online</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm">Extrator Google Maps</span>
              </div>
              <span className="text-xs text-green-500 font-medium">Online</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <span className="text-sm">Supabase Connection</span>
              </div>
              <span className="text-xs text-amber-500 font-medium">Latência Alta</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
