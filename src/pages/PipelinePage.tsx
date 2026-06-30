import PipelineBoard from '../components/PipelineBoard';

export default function PipelinePage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Pipeline</h2>
        <p className="mt-1 text-gray-600">
          Track applications across every stage of your search.
        </p>
      </div>
      <PipelineBoard />
    </div>
  );
}
