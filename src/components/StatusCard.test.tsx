import { render } from '@testing-library/react';
import { FiCheckCircle } from 'react-icons/fi';
import { StatusCard } from './StatusCard';

describe('StatusCard', () => {
  it('renders without crashing', () => {
    render(
      <StatusCard
        icon={<FiCheckCircle />}
        count={5}
        label="Completed"
        onClick={jest.fn()}
      />,
    );
  });
});
