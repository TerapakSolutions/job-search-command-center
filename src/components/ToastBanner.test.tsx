import { render } from '@testing-library/react';
import { ToastBanner } from './ToastBanner';

describe('ToastBanner', () => {
  it('renders without crashing', () => {
    render(
      <ToastBanner message="Test message" visible={true} onClose={jest.fn()} duration={1000} />,
    );
  });
});
