# language: es
Característica: Consultar al tutor IA
  Como Estudiante
  quiero preguntarle al tutor IA dudas sobre el contenido de mi curso
  para resolverlas fuera del horario de clases con información confiable del currículum

  Escenario: El tutor IA responde con base en los apuntes del curso
    Dado que estoy en el curso "Matemática 8vo Básico" con apuntes cargados
    Cuando le pregunto al tutor IA una duda sobre esa materia
    Entonces recibo una respuesta basada en el contenido (RAG) de ese curso

  Escenario: El tutor IA no inventa respuestas fuera del temario
    Dado que le hago una pregunta al tutor IA que está fuera del temario del curso
    Cuando el tutor IA no encuentra contenido de respaldo en los apuntes
    Entonces responde indicando que no tiene información suficiente, sin inventar una respuesta

  Escenario: El tutor IA no usa apuntes de otro colegio
    Dado que soy estudiante del tenant "Colegio San Rafael"
    Cuando le hago una consulta al tutor IA
    Entonces solo se usan como fuente los apuntes de mi propio tenant y curso, nunca los de otro colegio
