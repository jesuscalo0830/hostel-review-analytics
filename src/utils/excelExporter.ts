import * as XLSX from 'xlsx';
import { BookingReview, ScoreAverages } from '../types';
import { resolvePropertyForReview } from '../constants';

export const exportToExcel = (
  reviews: BookingReview[],
  averages: ScoreAverages | null,
  fileName: string = 'Hostel_Analytics_Report.xlsx'
) => {
  const wb = XLSX.utils.book_new();

  // 1. Executive Summary Sheet
  if (averages) {
    const summaryData = [
      { Metric: 'Overall Score', Rating: averages.overall },
      { Metric: 'Staff Rating', Rating: averages.staff },
      { Metric: 'Cleanliness Rating', Rating: averages.cleanliness },
      { Metric: 'Location Rating', Rating: averages.location },
      { Metric: 'Facilities Rating', Rating: averages.facilities },
      { Metric: 'Comfort Rating', Rating: averages.comfort },
      { Metric: 'Value for Money', Rating: averages.valueForMoney },
      { Metric: 'Total Reviews Analyzed', Rating: reviews.length },
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Executive Summary');
  }

  // 2. Filtered Reviews Sheet
  const reviewsData = reviews.map((r, idx) => ({
    '#': idx + 1,
    'Date': r.reviewDate || '',
    'Booking ID': r.reservationNumber || '',
    'Guest Name': r.guestName || '',
    'Property': r.property || resolvePropertyForReview(r) || '',
    'Platform': r.platform || 'Booking',
    'Room / Rental': r.roomName || '',
    'Overall Score': r.reviewScore || 0,
    'Staff': r.staff || 0,
    'Cleanliness': r.cleanliness || 0,
    'Location': r.location || 0,
    'Facilities': r.facilities || 0,
    'Comfort': r.comfort || 0,
    'Value': r.valueForMoney || 0,
    'Title': r.translatedTitle || r.reviewTitle || '',
    'Positive Feedback': r.translatedPositive || r.positiveReview || '',
    'Negative Feedback': r.translatedNegative || r.negativeReview || '',
    'Traveler Type': r.travelerType || '',
    'Country': r.country || '',
    'Property Response': r.translatedReply || r.propertyReply || '',
  }));

  const reviewsSheet = XLSX.utils.json_to_sheet(reviewsData);
  XLSX.utils.book_append_sheet(wb, reviewsSheet, 'Reviews Data');

  // Trigger file download
  XLSX.writeFile(wb, fileName);
};
