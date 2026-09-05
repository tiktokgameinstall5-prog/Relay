import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPasscode } from './ForgotPasscode';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';

vi.mock('../api/auth', () => ({
  requestPasscodeReset: vi.fn(),
}));
const mockedAuthApi = vi.mocked(authApi);

describe('ForgotPasscode Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form and sends reset request', async () => {
    mockedAuthApi.requestPasscodeReset.mockResolvedValueOnce({
      message: 'If an eligible account exists with that email, a passcode reset link has been dispatched.',
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ForgotPasscode />
      </MemoryRouter>,
    );

    expect(screen.getByText('Forgot Passcode')).toBeInTheDocument();
    const emailInput = screen.getByPlaceholderText('member@company.com');
    await user.type(emailInput, 'bob@acme.test');

    const submitBtn = screen.getByRole('button', { name: /send passcode reset/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockedAuthApi.requestPasscodeReset).toHaveBeenCalledWith('bob@acme.test');
      expect(
        screen.getByText(
          'If an eligible account exists with that email, a passcode reset link has been dispatched.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('displays error banner when request fails', async () => {
    mockedAuthApi.requestPasscodeReset.mockRejectedValueOnce(
      new ApiError(429, 'Too many requests. Please wait a moment.'),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ForgotPasscode />
      </MemoryRouter>,
    );

    const emailInput = screen.getByPlaceholderText('member@company.com');
    await user.type(emailInput, 'bob@acme.test');

    const submitBtn = screen.getByRole('button', { name: /send passcode reset/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText('Too many requests. Please wait a moment.'),
      ).toBeInTheDocument();
    });
  });
});
