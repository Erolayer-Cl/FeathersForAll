# language: es
Característica: Crear evaluación auto-corregida
  Como Docente
  quiero crear una evaluación de alternativas con retroalimentación por pregunta
  para ahorrar tiempo de corrección y dar respuesta oportuna a mis estudiantes

  Escenario: Crear una evaluación con preguntas de alternativas
    Dado que existe el curso "Matemática 8vo Básico"
    Cuando creo una evaluación con 5 preguntas de alternativas marcando la respuesta correcta en cada una
    Entonces la evaluación queda disponible para ese curso

  Escenario: Definir retroalimentación por pregunta
    Dado que la evaluación "Prueba Fracciones" está publicada
    Cuando defino un texto de retroalimentación para una de sus preguntas
    Entonces ese texto se muestra al estudiante después de responder esa pregunta

  Escenario: No se puede publicar una evaluación incompleta
    Dado que la evaluación "Prueba Fracciones" tiene una pregunta sin respuesta correcta definida
    Cuando intento publicar la evaluación
    Entonces el sistema impide la publicación y muestra el motivo del rechazo
