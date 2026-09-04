import { useRouteError, Link } from 'react-router-dom';

export default function ErrorPage() {
  const error = useRouteError() as { statusText?: string; message?: string };
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold text-slate-900">문제가 발생했습니다</h1>
      <p className="text-sm text-slate-500">{error?.statusText || error?.message || '알 수 없는 오류'}</p>
      <Link to="/" className="mt-2 rounded-lg bg-brand px-4 py-2 text-white">
        목록으로
      </Link>
    </div>
  );
}
