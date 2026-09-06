import {
  renderBaseLayout,
  renderEmailButton,
  renderPasscodeBox,
  renderInviteEmail,
  renderPasscodeResetEmail,
  renderTaskNotificationEmail,
} from './templates';

describe('Mail Templates & Layout', () => {
  describe('renderBaseLayout & layout helpers', () => {
    it('renders base HTML structure with Relay branding and footer', () => {
      const html = renderBaseLayout({
        title: 'Test Email Title',
        preheader: 'Important preview snippet',
        bodyContent: '<p>Hello World</p>',
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test Email Title');
      expect(html).toContain('Important preview snippet');
      expect(html).toContain('<p>Hello World</p>');
      expect(html).toContain('Relay<span style="color: #3654F4;">.</span>');
      expect(html).toContain('Sent by <strong>Relay</strong>');
    });

    it('renders bulletproof CTA button with Signal Indigo (#3654F4)', () => {
      const button = renderEmailButton('Activate Account', 'http://localhost:5173/invite?email=test@example.com');
      expect(button).toContain('href="http://localhost:5173/invite?email=test@example.com"');
      expect(button).toContain('Activate Account &rarr;');
      expect(button).toContain('background-color: #3654F4');
    });

    it('renders passcode box with monospace styling and expiration notice', () => {
      const box = renderPasscodeBox('CODE-1234', 72);
      expect(box).toContain('CODE-1234');
      expect(box).toContain('Single-Use Passcode');
      expect(box).toContain('Expires in <strong>72 hours</strong>');
      expect(box).toContain('font-family: \'SFMono-Regular\'');
    });
  });

  describe('renderInviteEmail', () => {
    it('generates rich HTML and plain text with activate button and passcode box', () => {
      const result = renderInviteEmail({
        recipientName: 'Alex Smith',
        organizationName: 'Acme Corp',
        passcode: 'ABCD-9876',
        inviteLink: 'http://localhost:5173/invite?email=alex%40example.com',
        ttlHours: 72,
      });

      expect(result.subject).toBe("You've been invited to Acme Corp on Relay");

      // HTML validations
      expect(result.html).toContain('Join Acme Corp on Relay');
      expect(result.html).toContain('Alex Smith');
      expect(result.html).toContain('ABCD-9876');
      expect(result.html).toContain('Activate Account & Set Password');
      expect(result.html).toContain('http://localhost:5173/invite?email=alex%40example.com');
      expect(result.html).toContain('#3654F4');

      // Security check: URL must NOT contain the passcode
      expect(result.html).not.toContain('email=alex%40example.com&passcode=');
      expect(result.text).not.toContain('email=alex%40example.com&passcode=');

      // Text fallback validations
      expect(result.text).toContain('Hi Alex Smith,');
      expect(result.text).toContain('Your passcode: ABCD-9876');
      expect(result.text).toContain('Activate your account and set your password here:');
      expect(result.text).toContain('http://localhost:5173/invite?email=alex%40example.com');
      expect(result.text).toContain('(expires in 72 hours)');
    });
  });

  describe('renderPasscodeResetEmail', () => {
    it('generates rich HTML and plain text for passcode reset', () => {
      const result = renderPasscodeResetEmail({
        recipientName: 'Taylor Jones',
        passcode: 'RESET-5544',
        resetLink: 'http://localhost:5173/first-login?email=taylor%40example.com',
        ttlHours: 72,
      });

      expect(result.subject).toBe('Your Relay Passcode Reset');

      // HTML validations
      expect(result.html).toContain('Reset Your Relay Passcode');
      expect(result.html).toContain('Taylor Jones');
      expect(result.html).toContain('RESET-5544');
      expect(result.html).toContain('Reset Password & Sign In');
      expect(result.html).toContain('http://localhost:5173/first-login?email=taylor%40example.com');

      // Text fallback validations
      expect(result.text).toContain('Hello Taylor Jones,');
      expect(result.text).toContain('Your passcode: RESET-5544');
      expect(result.text).toContain('http://localhost:5173/first-login?email=taylor%40example.com');
      expect(result.text).toContain('expires in 72 hours');
    });
  });

  describe('renderTaskNotificationEmail', () => {
    it('generates notification email with status badge and workspace link', () => {
      const result = renderTaskNotificationEmail({
        title: 'Task Ready for Review',
        body: 'Step 2 has been completed and requires your review.',
        actionUrl: 'http://localhost:5173/tasks',
        statusBadge: 'STEP ACTIVATED',
      });

      expect(result.subject).toBe('Relay: Task Ready for Review');
      expect(result.html).toContain('Task Ready for Review');
      expect(result.html).toContain('STEP ACTIVATED');
      expect(result.html).toContain('View in Relay Workspace');
      expect(result.html).toContain('http://localhost:5173/tasks');

      expect(result.text).toContain('Task Ready for Review');
      expect(result.text).toContain('Step 2 has been completed and requires your review.');
      expect(result.text).toContain('http://localhost:5173/tasks');
    });

    it('respects custom subject and recipient name when provided', () => {
      const result = renderTaskNotificationEmail({
        recipientName: 'Morgan',
        title: 'Step Forwarded',
        subject: '[Action Required] Step Forwarded: Design Spec',
        body: 'You have been assigned as the reviewer.',
        actionUrl: 'http://localhost:5173/tasks',
        actionLabel: 'Review Task Now',
      });

      expect(result.subject).toBe('[Action Required] Step Forwarded: Design Spec');
      expect(result.html).toContain('Morgan');
      expect(result.html).toContain('Review Task Now');
      expect(result.text).toContain('Hi Morgan,');
    });
  });
});
