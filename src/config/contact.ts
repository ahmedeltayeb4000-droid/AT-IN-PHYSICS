export type ContactChannel = {
  readonly label: string;
  readonly href: string;
};

type ContactConfiguration = {
  readonly email: string | null;
  readonly whatsappNumber: string | null;
};

// Add verified public contact details here when the Owner is ready to publish them.
// Never source contact details from private credentials or secret environment values.
export const contactConfiguration: ContactConfiguration = {
  email: null,
  whatsappNumber: null,
};

export const contactAvailabilityMessage =
  "Public contact details are not currently listed. Please use your established A.T IN PHYSICS communication channel.";

export function getContactChannels(
  configuration: ContactConfiguration = contactConfiguration,
): readonly ContactChannel[] {
  const channels: ContactChannel[] = [];
  if (configuration.email) {
    channels.push({
      label: "Email A.T IN PHYSICS",
      href: `mailto:${configuration.email}`,
    });
  }
  if (configuration.whatsappNumber) {
    channels.push({
      label: "Message A.T IN PHYSICS on WhatsApp",
      href: `https://wa.me/${configuration.whatsappNumber}`,
    });
  }
  return channels;
}
