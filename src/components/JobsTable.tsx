import { useEffect, useState } from 'react';
import { fetchJobs } from '../api/supabaseJobsClient';
import type { Job } from '../types/job';

export default function JobsTable() {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const loadJobs = async () => {
      const data = await fetchJobs();
      setJobs(data);
    };

    void loadJobs();
  }, []);

  return (
    <div>
      <h3 className="font-bold mb-2">Company Title Status</h3>
      <ul>
        {jobs.map((job) => (
          <li key={job.id}>
            {job.company} - {job.title} ({job.status})
          </li>
        ))}
      </ul>
    </div>
  );
}
