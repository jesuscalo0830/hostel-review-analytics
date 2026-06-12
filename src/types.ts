export type ReviewPlatform = 'Booking' | 'Agoda' | 'PMS' | 'Other';

export interface BookingReview {
  reviewDate: string;
  reservationNumber: string;
  /** Guest name from the source CSV. Optional; may be empty if not provided. */
  guestName?: string;
  reviewTitle: string;
  roomName: string;
  positiveReview: string;
  negativeReview: string;
  reviewScore: number;
  staff: number;
  cleanliness: number;
  location: number;
  facilities: number;
  comfort: number;
  valueForMoney: number;
  propertyReply: string;
  /** Source platform of the review. Booking is assumed when absent for backward compatibility. */
  platform?: ReviewPlatform;
  /** Property/hostel name. Set at upload time via majority-vote detection on the file. */
  property?: string;
  translatedPositive?: string;
  translatedNegative?: string;
  translatedTitle?: string;
  translatedReply?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface ScoreAverages {
  overall: number;
  staff: number;
  cleanliness: number;
  location: number;
  facilities: number;
  comfort: number;
  valueForMoney: number;
}

export interface MonthlyTrend {
  month: string;
  score: number;
}

export interface UploadLogEntry {
  id: string;
  fileName: string;
  uploadedAt: string;   // ISO timestamp
  rowsParsed: number;
  rowsAdded: number;
  platform: string;
  properties: string[];
}
