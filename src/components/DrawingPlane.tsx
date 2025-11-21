import type { FC } from 'react'
import { useCallback, useMemo, useState, useEffect } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, Html } from '@react-three/drei'
import * as THREE from 'three'

export type Point3 = [number, number, number]

export type Segment = {
  id: string
  start: Point3
  end: Point3
}

type DrawingPlaneProps = {
  isDrawingMode: boolean
  snapGridEnabled: boolean
  segments: Segment[]
  onChangeSegments: (next: Segment[]) => void
  selectedId: string | null
  onSelectSegment: (id: string | null) => void
}

// --- math + snapping here ---
const SNAP_RADIUS = 0.5
const GRID_SIZE = 0.25
const WALL_HEIGHT = 3
const WALL_WIDTH = 0.2
const MIN_ANGLE_DEG = 30
const MIN_ANGLE_RAD = (MIN_ANGLE_DEG * Math.PI) / 180

const snapToGrid = (p: Point3): Point3 => [
  Math.round(p[0] / GRID_SIZE) * GRID_SIZE, p[1], Math.round(p[2] / GRID_SIZE) * GRID_SIZE
]

const angleAtVertexDot = (a: Point3, b: Point3, c: Point3): number => {
  const ux = a[0] - b[0], uz = a[2] - b[2]
  const vx = c[0] - b[0], vz = c[2] - b[2]
  const dot = ux * vx + uz * vz
  const lenU = Math.hypot(ux, uz), lenV = Math.hypot(vx, vz)
  if (lenU === 0 || lenV === 0) return 0
  let cos = dot / (lenU * lenV)
  cos = Math.min(1, Math.max(-1, cos))
  return Math.acos(cos)
}

type IntersectionWithT = { hit: boolean, point?: Point3, t?: number }
const segmentsIntersectionPoint2DWithT = (
  p1: Point3, p2: Point3, p3: Point3, p4: Point3
): IntersectionWithT => {
  const [x1, , z1] = p1, [x2, , z2] = p2, [x3, , z3] = p3, [x4, , z4] = p4
  const denom = (x1-x2)*(z3-z4) - (z1-z2)*(x3-x4)
  if (Math.abs(denom) < 1e-6) return { hit: false }
  const t = ((x1-x3)*(z3-z4) - (z1-z3)*(x3-x4)) / denom
  const u = ((x1-x3)*(z1-z2) - (z1-z3)*(x1-x2)) / denom
  if (t > 1e-6 && t < 1-1e-6 && u > 1e-6 && u < 1-1e-6) {
    const ix = x1 + t*(x2-x1), iz = z1 + t*(z2-z1)
    return { hit: true, point: [ix, 0, iz], t }
  }
  return { hit: false }
}

const wouldIntersectExistingWalls = (
  start: Point3, end: Point3, segments: Segment[]
) => segments.some(seg => segmentsIntersectionPoint2DWithT(start, end, seg.start, seg.end).hit)



// --- visuals all here---
const VertexMarker: FC<{ position: Point3 }> = ({ position }) => {
  const { camera } = useThree()
  const markerW = WALL_WIDTH * 1.8, markerD = WALL_WIDTH * 1.8
  const markerH = WALL_HEIGHT + 0.4, yCenter = WALL_HEIGHT / 2
  const viewDir = new THREE.Vector3()
  camera.getWorldDirection(viewDir).normalize()
  const offset = viewDir.multiplyScalar(-0.01)
  return (
    <mesh
      position={[
        position[0] + offset.x,
        yCenter,
        position[2] + offset.z,
      ]}
      renderOrder={2}
    >
      <boxGeometry args={[markerW, markerH, markerD]} />
      <meshStandardMaterial color="#7c4dff" opacity={0.6} transparent depthWrite={false} />
    </mesh>
  )
}

const WallSegment: FC<{
  segment: Segment, selected: boolean, isDrawingMode: boolean, onSelect: (id: string | null) => void
}> = ({ segment, selected, isDrawingMode, onSelect }) => {
  const { start, end } = segment
  const dx = end[0] - start[0], dz = end[2] - start[2]
  const length = Math.sqrt(dx*dx + dz*dz) || 0.0001
  const angleY = Math.atan2(dz, dx)
  const mid: Point3 = [(start[0]+end[0])/2, WALL_HEIGHT/2, (start[2]+end[2])/2]
  const margin = WALL_WIDTH * 0.5
  const displayLen = length > 2*margin ? length-2*margin : length*0.5
  return (
    <mesh
      position={mid}
      rotation={[0, -angleY, 0]}
      onClick={e => {
        e.stopPropagation()
        if (isDrawingMode) return
        onSelect(selected ? null : segment.id)
      }}
    >
      <boxGeometry args={[displayLen, WALL_HEIGHT, WALL_WIDTH]} />
      <meshStandardMaterial
        color={selected ? '#ff9800' : '#aaaaaa'}
        opacity={selected ? 0.9 : 1}
        transparent
      />
    </mesh>
  )
}


// --- main drawing plane  ---
export const DrawingPlane: FC<DrawingPlaneProps> = ({
  isDrawingMode,
  snapGridEnabled,
  segments,
  onChangeSegments,
  selectedId,
  onSelectSegment,
}) => {
  const { camera } = useThree()
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<Point3 | null>(null)
  const [currentPoint, setCurrentPoint] = useState<Point3 | null>(null)
  const [previewAngle, setPreviewAngle] = useState<number | null>(null)
  const [previewBlocked, setPreviewBlocked] = useState(false)
  const [canPlaceWall, setCanPlaceWall] = useState(true)

  useEffect(() => {
    if (!isDrawingMode) {
      console.log('Drawing mode exited: resetting state.')
      setIsDrawing(false)
      setStartPoint(null)
      setCurrentPoint(null)
      setPreviewAngle(null)
      setPreviewBlocked(false)
      setCanPlaceWall(true)
    }
  }, [isDrawingMode])

  const snapPoints = useMemo<Point3[]>(() =>
    segments.flatMap(s => [s.start, s.end]), [segments])
  const uniqueVertices = useMemo<Point3[]>(() => {
    const map = new Map<string, Point3>()
    for (const p of snapPoints) map.set(`${p[0]}_${p[2]}`, p)
    return Array.from(map.values())
  }, [snapPoints])

  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const getPlaneIntersection = useCallback((event: ThreeEvent<PointerEvent>) => {
    const ndc = event.pointer
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera)
    const intersection = new THREE.Vector3()
    raycaster.ray.intersectPlane(plane, intersection)
    if (!intersection) return null
    return [intersection.x, intersection.y, intersection.z] as Point3
  }, [camera, plane, raycaster])

  const applySnap = useCallback((p: Point3 | null): Point3 | null => {
    if (!p) return p
    let snapped = snapGridEnabled ? snapToGrid(p) : p
    if (!snapPoints.length) return snapped
    let closest: Point3 | null = null
    let minDistSq = SNAP_RADIUS ** 2
    for (const sp of snapPoints) {
      const dx = sp[0] - snapped[0], dz = sp[2] - snapped[2]
      const distSq = dx * dx + dz * dz
      if (distSq <= minDistSq) {
        minDistSq = distSq
        closest = sp
      }
    }
    if (closest) {
      console.log('Snapped to nearby point:', closest)
    } else if (snapGridEnabled) {
      console.log('Snapped to grid:', snapped)
    }
    return closest ?? snapped
  }, [snapGridEnabled, snapPoints])

  const resetDrawing = () => {
    setIsDrawing(false)
    setStartPoint(null)
    setCurrentPoint(null)
    setPreviewAngle(null)
    setPreviewBlocked(false)
    setCanPlaceWall(true)
  }

  // Main click handler
  const handleClick = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isDrawingMode) return
    const raw = getPlaneIntersection(event)
    const p = applySnap(raw)
    if (!p) return

    if (!isDrawing) {
      console.log('Begin drawing at', p)
      setStartPoint(p)
      setCurrentPoint(p)
      setIsDrawing(true)
      setPreviewAngle(null)
      setPreviewBlocked(false)
      setCanPlaceWall(true)
      onSelectSegment(null)
      return
    }
    if (!startPoint) return

    // check for the first t section
    let bestHit: IntersectionWithT | null = null, bestSeg: Segment | null = null
    for (const seg of segments) {
      const res = segmentsIntersectionPoint2DWithT(startPoint, p, seg.start, seg.end)
      if (res.hit && res.point && res.t !== undefined) {
        if (!bestHit || res.t < (bestHit.t as number)) {
          bestHit = res
          bestSeg = seg
        }
      }
    }
    if (bestHit && bestSeg) {
      const intersectionPoint = snapToGrid(bestHit.point!)
      console.log(
        'T-intersection detected. Splitting wall at',
        intersectionPoint,
        'Splitting segment:', bestSeg
      )
      const snappedNewSeg: Segment = { id: crypto.randomUUID(), start: startPoint, end: intersectionPoint }
      const segA: Segment = { id: crypto.randomUUID(), start: bestSeg.start, end: intersectionPoint }
      const segB: Segment = { id: crypto.randomUUID(), start: intersectionPoint, end: bestSeg.end }
      const next: Segment[] = segments.flatMap(s =>
        s.id === bestSeg.id ? [segA, segB] : [s])
      next.push(snappedNewSeg)
      onChangeSegments(next)
      resetDrawing()
      return
    }

    if (!canPlaceWall) {
      console.log('Blocked: Attempted to place wall with invalid angle or intersection.')
      return
    }

    // place regular walls,
    console.log('Adding new wall segment:', { start: startPoint, end: p })
    const newSeg: Segment = { id: crypto.randomUUID(), start: startPoint, end: p }
    const next = [...segments, newSeg]
    onChangeSegments(next)
    resetDrawing()
  }, [
    applySnap, canPlaceWall, getPlaneIntersection,
    isDrawing, isDrawingMode, onChangeSegments, onSelectSegment, segments, snapPoints, startPoint,
  ])

  const handlePointerMove = useCallback((event: ThreeEvent<PointerEvent>) => {
    if (!isDrawingMode || !isDrawing) return
    const raw = getPlaneIntersection(event)
    const p = applySnap(raw)
    if (!p) return
    setCurrentPoint(p)
    if (!startPoint) return

    let tooSharp = false
    const b = startPoint
    const lastTouching = [...segments].reverse().find(
      seg =>
        (seg.start[0] === b[0] && seg.start[2] === b[2]) ||
        (seg.end[0] === b[0] && seg.end[2] === b[2]),
    )
    if (lastTouching) {
      const a =
        lastTouching.start[0] === b[0] && lastTouching.start[2] === b[2]
          ? lastTouching.end : lastTouching.start
      const c = p
      const angle = angleAtVertexDot(a, b, c)
      tooSharp = angle < MIN_ANGLE_RAD
      setPreviewAngle(angle)
      console.log('Pointer moved: preview angle', (angle * 180 / Math.PI).toFixed(1), 'deg; Too sharp:', tooSharp)
    } else {
      setPreviewAngle(null)
      console.log('Pointer moved: no candidate angle at vertex')
    }
    const intersects = wouldIntersectExistingWalls(startPoint, p, segments)
    if (intersects) {
      console.log('Preview: candidate wall would intersect an existing wall.')
    }
    const blocked = tooSharp || intersects
    setPreviewBlocked(blocked)
    setCanPlaceWall(!blocked)
  }, [applySnap, getPlaneIntersection, isDrawingMode, isDrawing, startPoint, segments])

  
  // Rendering walls and angles 
  return (
    <>
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={handleClick}
        onPointerMove={handlePointerMove}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      {segments.map(seg => (
        <Line
          key={`line-${seg.id}`}
          points={[seg.start, seg.end]}
          color="white"
          lineWidth={1}
          position={[0, 0.01, 0]}
        />
      ))}
      {segments.map(seg => (
        <WallSegment
          key={`wall-${seg.id}`}
          segment={seg}
          selected={selectedId === seg.id}
          isDrawingMode={isDrawingMode}
          onSelect={onSelectSegment}
        />
      ))}
      {uniqueVertices.map((v, i) => (
        <VertexMarker key={`v-${i}`} position={v} />
      ))}
      {isDrawing && startPoint && currentPoint && (
        <Line
          points={[startPoint, currentPoint]}
          color={previewBlocked ? 'red' : 'cyan'}
          lineWidth={1}
          position={[0, 0.011, 0]}
        />
      )}
      {isDrawing && startPoint && previewAngle !== null && (
        <Html
          position={[startPoint[0], WALL_HEIGHT + 0.1, startPoint[2]]}
          center
          style={{
            color: previewBlocked ? 'red' : 'white',
            fontSize: '11px',
            fontFamily: 'system-ui, sans-serif',
            background: 'rgba(0,0,0,0.7)',
            padding: '2px 4px',
            borderRadius: '3px',
            whiteSpace: 'nowrap',
          }}
        >
          {(previewAngle * 180 / Math.PI).toFixed(1)}°
        </Html>
      )}
    </>
  )
}
