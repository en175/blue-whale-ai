import { useLocation, useNavigate } from 'react-router-dom';

export default function CanvasPageNavProbe({ onChange }: { onChange: (navigate: ReturnType<typeof useNavigate>, search: string) => void }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  onChange(navigate, search);
  return null;
}
