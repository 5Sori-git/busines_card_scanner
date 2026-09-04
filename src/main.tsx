import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createHashRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import Layout from './components/Layout';
import ListPage from './pages/ListPage';
import ScanPage from './pages/ScanPage';
import EditPage from './pages/EditPage';
import DetailPage from './pages/DetailPage';
import ErrorPage from './pages/ErrorPage';

// 정적 호스팅 + 오프라인 안정성을 위해 HashRouter 사용 (딥링크 새로고침에도 서버 rewrite 불필요).
const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <ListPage /> },
      { path: 'scan', element: <ScanPage /> },
      { path: 'new', element: <EditPage mode="new" /> },
      { path: 'contact/:id', element: <DetailPage /> },
      { path: 'contact/:id/edit', element: <EditPage mode="edit" /> },
    ],
  },
]);

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
