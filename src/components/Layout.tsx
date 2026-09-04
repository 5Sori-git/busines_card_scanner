import { Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col bg-slate-100">
      <Outlet />
    </div>
  );
}
