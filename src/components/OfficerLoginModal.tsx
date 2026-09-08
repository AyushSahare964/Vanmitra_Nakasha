import React, { useState } from "react";
import { ShieldCheck, UserCheck, KeyRound, Building2, X } from "lucide-react";

export interface OfficerProfile {
  name: string;
  role: string;
  designation: string;
  district: string;
  department: string;
  avatar: string;
}

interface OfficerLoginModalProps {
  isOpen?: boolean;
  open?: boolean;
  onClose: () => void;
  onLoginSuccess: (profile: OfficerProfile) => void;
}

const PRESET_OFFICERS: OfficerProfile[] = [
  {
    name: "Anand Oak",
    role: "Revenue Officer",
    designation: "Tehsildar & Executive Magistrate",
    district: "Nagpur / Nashik Division",
    department: "Maharashtra Revenue & Land Records Dept",
    avatar: "AO",
  },
  {
    name: "Rajesh Patil",
    role: "Cadastral Surveyor",
    designation: "Deputy Superintendent of Land Records",
    district: "Nagpur Cadastral Circle",
    department: "Directorate of Land Records, Pune",
    avatar: "RP",
  },
  {
    name: "Sunita Deshmukh",
    role: "Settlement Officer",
    designation: "Assistant Director of Town Planning & Land AI",
    district: "Vidarbha Urban CTSO Division",
    department: "Maharashtra GIS & Land Governance",
    avatar: "SD",
  },
];

export default function OfficerLoginModal({ isOpen, open, onClose, onLoginSuccess }: OfficerLoginModalProps) {
  const visible = isOpen ?? open ?? false;
  const [selectedRole, setSelectedRole] = useState<string>("Revenue Officer");
  const [username, setUsername] = useState("anand.oak@mahabhumi.gov.in");
  const [password, setPassword] = useState("••••••••••••");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!visible) return null;

  const handleLogin = (officer: OfficerProfile) => {
    setLoading(true);
    setError(null);
    setTimeout(() => {
      setLoading(false);
      onLoginSuccess(officer);
      onClose();
    }, 500);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const matched = PRESET_OFFICERS.find((o) => o.role === selectedRole) || PRESET_OFFICERS[0];
    handleLogin(matched);
  };

  return (
    <div id="officer-login-modal" className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden text-slate-800">
        {/* Modal Header */}
        <div className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 border-b border-slate-700">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 size-8 flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="size-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-xl bg-white p-1 flex items-center justify-center shadow-md">
              <img src="/team_advante_logo.jpg" alt="Team Advante" className="h-full w-full object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold tracking-wider text-base text-white">ADVANTE</span>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-red-700/90 text-white px-1.5 py-0.5 rounded">
                  Officer Portal
                </span>
              </div>
              <p className="text-xs text-slate-300">Maharashtra Land Records & Territorial Harmonization</p>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5">
            <ShieldCheck className="size-5 text-emerald-700 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-950">
              <span className="font-bold block">Government Officer & Surveyor Sign In</span>
              Sign in with your department credentials to review land boundaries, manage conflicts, and access the Officer Dashboard.
            </div>
          </div>

          {/* 1-Click Quick Demo Login */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
              Quick 1-Click Demo Login
            </span>
            <div className="grid grid-cols-1 gap-2">
              {PRESET_OFFICERS.map((officer) => (
                <button
                  key={officer.name}
                  type="button"
                  onClick={() => handleLogin(officer)}
                  disabled={loading}
                  className="w-full flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 transition-all text-left group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="size-8 rounded-full bg-slate-800 text-white font-bold text-xs flex items-center justify-center group-hover:bg-emerald-700 transition-colors">
                      {officer.avatar}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900 group-hover:text-emerald-900">
                        {officer.name}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {officer.designation} · {officer.role}
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100/60 px-2.5 py-1 rounded-md group-hover:bg-emerald-700 group-hover:text-white transition-colors">
                    Login ➔
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Manual Login Form */}
          <form onSubmit={handleFormSubmit} className="space-y-3 pt-2 border-t border-slate-100">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Select Role</label>
              <div className="grid grid-cols-3 gap-1.5">
                {["Revenue Officer", "Cadastral Surveyor", "Settlement Officer"].map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setSelectedRole(role)}
                    className={`py-1.5 px-2 text-[11px] font-semibold rounded-lg border transition-all truncate cursor-pointer ${
                      selectedRole === role
                        ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                        : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {role.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Official ID / Email</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-2.5 size-4 text-slate-400" />
                <input
                  type="email"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs font-medium focus:border-emerald-600 focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Password</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-2.5 size-4 text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-xs font-medium focus:border-emerald-600 focus:outline-none"
                  required
                />
              </div>
            </div>

            {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2.5 text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Authenticating Officer...</span>
                </>
              ) : (
                <>
                  <UserCheck className="size-4" />
                  <span>Sign In as {selectedRole}</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
