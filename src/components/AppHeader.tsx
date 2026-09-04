import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  back?: boolean | string;
  right?: ReactNode;
}

export default function AppHeader({ title, back, right }: Props) {
  const navigate = useNavigate();
  return (
    <header className="safe-top sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex h-14 items-center gap-1 px-2">
        {back ? (
          <button
            type="button"
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-full text-slate-600 active:bg-slate-100"
            aria-label="뒤로"
          >
            <ChevronLeft size={24} />
          </button>
        ) : (
          <div className="w-2" />
        )}
        <h1 className="flex-1 truncate text-lg font-semibold text-slate-900">{title}</h1>
        {right}
      </div>
    </header>
  );
}
