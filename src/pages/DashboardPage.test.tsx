import { render } from '@testing-library/react';
import DashboardPage from './DashboardPage';

describe('DashboardPage', () => {
  it('renders without crashing', () => {
    render(<DashboardPage />);
  });
});
