import { Hammer } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';

interface PlannedPageProps {
  title: string;
  description: string;
}

/** Stand-in for a page that is still being built, so navigation works end to end meanwhile. */
export function PlannedPage({ title, description }: PlannedPageProps) {
  return (
    <div className="page">
      <PageHeader title={title} description={description} />
      <EmptyState icon={<Hammer />} title={`${title} is being built`} description="This page arrives in the next update." />
    </div>
  );
}
