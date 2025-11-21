import type { FC } from 'react'
import '../App.css'
import { useEffect, useRef, useState, useCallback } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, OrthographicCamera } from '@react-three/drei'
import { GizmoHelper, GizmoViewport } from '@react-three/drei'
import * as THREE from 'three'
import { DrawingPlane, type Segment } from './DrawingPlane'


// Camera orientation orthographic camera
const TopViewSetter: FC = () => {
  const { camera } = useThree()
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    camera.position.set(0, 100, 0)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }, [camera])
  ;(window as any).setTopView = () => {
    camera.position.set(0, 100, 0)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }
  return null
}

export const CadViewport: FC = () => {
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [snapGridEnabled, setSnapGridEnabled] = useState(true)
  const [segments, setSegments] = useState<Segment[]>([])
  const [history, setHistory] = useState<Segment[][]>([])
  const [redoStack, setRedoStack] = useState<Segment[][]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const controlsRef = useRef<THREE.EventDispatcher | null>(null)

  void history; void redoStack;
  
  // -- history is for undo and redo --
  const pushHistory = useCallback((next: Segment[]) => {
    setHistory(prev => [...prev, segments])
    setRedoStack([])
    setSegments(next)
  }, [segments])

  const handleUndo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setRedoStack(r => [segments, ...r])
      setSegments(last)
      setSelectedId(null)
      return prev.slice(0, -1)
    })
  }, [segments])

  const handleRedo = useCallback(() => {
    setRedoStack(prev => {
      if (prev.length === 0) return prev
      const [next, ...rest] = prev
      setHistory(h => [...h, segments])
      setSegments(next)
      setSelectedId(null)
      return rest
    })
  }, [segments])

  const handleDeleteSelected = () => {
    if (!selectedId) return
    pushHistory(segments.filter(s => s.id !== selectedId))
    setSelectedId(null)
  }

  // -- taking q ket to come out of drawing more via keyboard --
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'q' || e.key === 'Q') {
        setIsDrawingMode(false)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        handleUndo()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        handleRedo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleUndo, handleRedo])

  const handleEnterDraw = () => {
    setIsDrawingMode(true)
    if ((window as any).setTopView) (window as any).setTopView()
    setSelectedId(null)
  }

  const handleTopView = () => {
    if ((window as any).setTopView) (window as any).setTopView()
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
<div className="cad-toolbar">
  
  <button
    onClick={handleEnterDraw}
    className={`cad-btn${isDrawingMode ? ' active' : ''}`}
  >
    Draw
  </button>
  
  <button
    onClick={() => setIsDrawingMode(false)}
    className="cad-btn"
  >
    Stop (Q)
  </button>
  
  <button
    onClick={handleTopView}
    className="cad-btn"
  >
    Top view
  </button>

    <button
    onClick={() => setSnapGridEnabled(v => !v)}
    className={`cad-btn${snapGridEnabled ? ' snap' : ''}`}
  >
    Snap grid
  </button>

  <button
    onClick={handleUndo}
    className="cad-btn"
  >
    Undo
  </button>

  <button
    onClick={handleRedo}
    className="cad-btn"
  >
    Redo
  </button>
  
  <button
    onClick={handleDeleteSelected}
    className={`cad-btn ${selectedId ? 'delete-active' : 'delete-inactive'}`}
  >
    Delete
  </button>

  <span>Left click draw • Q to quit • Click wall to select</span>
</div>

      <Canvas orthographic>
        <OrthographicCamera
          makeDefault
          position={[0, 100, 0]}
          up={[0, 0, -1]}
          zoom={40}
          near={-1000}
          far={1000}
        />
        
        <TopViewSetter />
        
        <OrbitControls
          enabled={!isDrawingMode}
          enablePan enableRotate enableZoom
          ref={controlsRef as any}
          mouseButtons={{ 
             
            MIDDLE: THREE.MOUSE.ROTATE, 
            RIGHT: THREE.MOUSE.PAN }}
        />
        
        <color attach="background" args={['#151515']} />
        
        <ambientLight intensity={0.5} />
        
        <directionalLight position={[5, 10, 5]} intensity={0.7} />
        
        {/* our main grid */}
        <gridHelper args={[100, 100, '#444444', '#222222']} position={[0, 0, 0]} />
        
        {/* Gizmo on top right */}
        <GizmoHelper alignment="top-right" margin={[80,80]}>
          <GizmoViewport axisColors={['#FF5252', '#46E268', '#329AFF']} labelColor="#fff" />
        </GizmoHelper>
      
        {/* DrawingPlane snapping flags */}
        <DrawingPlane
          isDrawingMode={isDrawingMode}
          snapGridEnabled={snapGridEnabled}
          segments={segments}
          onChangeSegments={pushHistory}
          selectedId={selectedId}
          onSelectSegment={setSelectedId}
        />
      </Canvas>
    </div>
  )
}
