import FrontDeskDashboard from "@/pages/FrontDeskDashboard";

/** Standalone route for manager/owner access to FO today view */
export default function FrontDeskDashboardPage() {
  return (
    <div className="p-6 md:p-8 lg:p-10 max-w-7xl mx-auto">
      <FrontDeskDashboard embedded={false} />
    </div>
  );
}
