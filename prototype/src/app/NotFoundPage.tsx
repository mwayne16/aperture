import { MapPinOff } from 'lucide-react';
import { Link } from 'wouter';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { paths } from './routes';

export function NotFoundPage() {
  return (
    <div className="page">
      <PageHeader title="Page not found" />
      <EmptyState
        icon={<MapPinOff />}
        title="There's nothing at this address"
        description="The page may have moved, or the link is out of date."
        action={
          <Link href={paths.dashboard} className="page-link">
            Go to the dashboard
          </Link>
        }
      />
    </div>
  );
}
