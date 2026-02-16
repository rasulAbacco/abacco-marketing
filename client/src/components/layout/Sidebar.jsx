// Sidebar.jsx - Responsive and Interactive Sidebar Component
import { NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Users,
  Mail,
  Megaphone,
  Shield,
  FileText,
  X,
  Sparkles,
  BarChart3,
  LogOut,
} from "lucide-react";

const navigationItems = [
  { name: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { name: "Leads", icon: Users, path: "/leads" },
  { name: "Inbox", icon: Mail, path: "/inbox" },
  { name: "Campaigns", icon: Megaphone, path: "/campaigns" },
  { name: "Pitches", icon: FileText, path: "/pitches" },
  { name: "Analytics", icon: BarChart3, path: "/analytics" },
  { name: "Admin", icon: Shield, path: "/admin" },
];

export default function Sidebar({ sidebarOpen, setSidebarOpen, setExpanded }) {
  const [userData, setUserData] = useState(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const navigate = useNavigate();

  // ✅ Fetch user data from localStorage on component mount
  useEffect(() => {
    const user = localStorage.getItem("user");
    if (user) {
      try {
        const parsedUser = JSON.parse(user);
        setUserData(parsedUser);
        
        // 🔍 Debug log
        console.log("Sidebar - User data:", parsedUser);
        console.log("Sidebar - User role:", parsedUser.jobRole);
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  }, []);

  // ✅ Get user's initials for avatar
  const getInitials = (name) => {
    if (!name) return "U";
    const names = name.trim().split(" ");
    if (names.length === 1) return names[0].charAt(0).toUpperCase();
    return (names[0].charAt(0) + names[names.length - 1].charAt(0)).toUpperCase();
  };

  // ✅ Check if user is admin (case-insensitive and handles all data types)
  const isAdmin = () => {
    if (!userData || !userData.jobRole) return false;
    const role = String(userData.jobRole).toLowerCase().trim();
    console.log("Checking if admin - role:", role, "isAdmin:", role === "admin");
    return role === "admin";
  };

  // ✅ Handle logout
  const handleLogout = () => {
    // Clear user data from localStorage
    localStorage.removeItem("user");
    localStorage.removeItem("token"); // If you have a token
    
    // Close modal
    setShowLogoutModal(false);
    
    // Redirect to login page
    navigate("/");
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden transition-opacity"
        />
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 transform transition-all">
            {/* Modal Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <LogOut className="text-red-600 dark:text-red-400" size={24} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                  Logout Confirmation
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Are you sure you want to leave?
                </p>
              </div>
            </div>

            {/* Modal Body */}
            <p className="text-slate-600 dark:text-slate-300 mb-6">
              You will be logged out of your account and redirected to the login page.
            </p>

            {/* Modal Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 px-4 py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 shadow-lg shadow-red-500/30 transition-all"
              >
                Confirm Logout
              </button>
            </div>
          </div>
        </div>
      )}

      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className="
          group fixed top-0 left-0 h-screen
          w-20 hover:w-64
          bg-gradient-to-b from-white via-emerald-50/30 to-green-50/30 
          dark:from-slate-900 dark:via-emerald-950/20 dark:to-green-950/20
          border-r border-emerald-100 dark:border-emerald-900/50
          transition-all duration-300 ease-in-out
          z-50 overflow-hidden
          shadow-xl shadow-emerald-500/5
        "
      >
        <div className="flex flex-col h-full p-4">

          {/* Close button (mobile) */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden self-end p-2 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
          >
            <X size={20} className="text-slate-600 dark:text-slate-400" />
          </button>

          {/* Brand */}
          <div className="mb-8 flex items-center gap-3">
            <div className="min-w-[40px] h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 via-green-600 to-emerald-700 text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-emerald-500/50 ring-2 ring-emerald-400/20">
              <Sparkles size={24} strokeWidth={2.5} />
            </div>

            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
              <h1 className="text-base font-bold bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent">
                Abacco Marketing
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">Marketing Intelligence</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto">
            <div className="space-y-1.5">
              {/* ✅ Filter menu items based on role (case-insensitive) */}
              {navigationItems
                .filter((item) => {
                  // If item is Admin tab, only show to admin users
                  if (item.name === "Admin") {
                    const shouldShow = isAdmin();
                    console.log("Admin tab - should show:", shouldShow);
                    return shouldShow;
                  }
                  return true;
                })
                .map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `
                      flex items-center gap-3
                      px-3 py-3 rounded-xl text-sm font-medium 
                      transition-all duration-200
                      relative overflow-hidden
                      ${
                        isActive
                          ? "bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/40 scale-100"
                          : "text-slate-700 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400 hover:scale-105"
                      }
                    `
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-white rounded-r-full" />
                        )}

                        {/* Icon */}
                        <div className="min-w-[20px] flex justify-center">
                          <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                        </div>

                        {/* Label */}
                        <span
                          className="
                            whitespace-nowrap
                            opacity-0 group-hover:opacity-100
                            transition-opacity duration-200
                            font-semibold
                          "
                        >
                          {item.name}
                        </span>
                      </>
                    )}
                  </NavLink>
                ))}
            </div>
          </nav>

          {/* Footer - user section & logout */}
          <div className="pt-4 mt-4 border-t border-emerald-200 dark:border-emerald-900/50 space-y-2">
            {/* User Info */}
            <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all duration-200 cursor-pointer">
              <div className="min-w-[30px] h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-md">
                <span className="text-sm font-bold text-white">
                  {userData ? getInitials(userData.name) : "U"}
                </span>
              </div>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {userData?.name || "User"}
                </p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  {userData?.jobRole || "Role"} • {userData?.email || "user@abacco.com"}
                </p>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={() => setShowLogoutModal(true)}
              className="
                w-full flex items-center gap-3
                px-3 py-3 rounded-xl text-sm font-medium
                text-red-600 dark:text-red-400
                hover:bg-red-50 dark:hover:bg-red-900/20
                transition-all duration-200
                group/logout
              "
            >
              <div className="min-w-[20px] flex justify-center">
                <LogOut size={20} strokeWidth={2} />
              </div>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 font-semibold whitespace-nowrap">
                Logout
              </span>
            </button>
          </div>
        </div>

        {/* Decorative element */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-emerald-500/10 to-green-500/10 rounded-full blur-3xl -z-10" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-gradient-to-tr from-green-500/10 to-emerald-500/10 rounded-full blur-3xl -z-10" />
      </aside>
    </>
  );
}