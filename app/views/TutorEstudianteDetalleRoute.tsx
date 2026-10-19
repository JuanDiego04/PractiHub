'use client'

import { useParams } from 'next/navigation'
import TutorEstudianteDetalleView from '@/app/views/TutorEstudianteDetalleView'

export default function TutorEstudianteDetalleRoute() {
  const { id } = useParams<{ id: string }>()
  return <TutorEstudianteDetalleView assignmentId={id} />
}
