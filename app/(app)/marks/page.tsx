import { redirect } from 'next/navigation';

/** Marks live under an exam series; this is the way in. */
export default function MarksIndexPage() {
  redirect('/exams');
}
